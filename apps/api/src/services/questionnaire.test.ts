import { describe, expect, it } from 'vitest';
import { intakeQuestions, validateQuestionnaire } from './questionnaire.js';
const likert = intakeQuestions.find((q) => q.type === 'likert');
const multi = intakeQuestions.find((q) => q.type === 'multi_select');
if (!likert || !multi) throw new Error('Missing catalogue fixtures');
const likertId = likert.id;
const multiId = multi.id;
describe('questionnaire supplied answer validation', () => {
  it('keeps missing and explicit unknown as gaps with no inferred scores', () => {
    const result = validateQuestionnaire({
      answers: [
        { questionId: likertId, value: 5 },
        { questionId: multiId, unknown: true },
      ],
    });
    expect(result.report.answeredCount).toBe(1);
    expect(result.report.unknownCount).toBe(1);
    expect(result.report.gaps).toHaveLength(intakeQuestions.length - 1);
    expect(result.supplied).toHaveLength(2);
    expect(result.report).not.toHaveProperty('compositeScore');
  });
  it.each([0, 6, 1.5, '5', null])('rejects invalid Likert value %s', (value) => {
    expect(() => validateQuestionnaire({ answers: [{ questionId: likertId, value }] })).toThrow();
  });
  it('rejects duplicate questions, unknown identifiers, and contradictory unknown answers', () => {
    for (const answers of [
      [
        { questionId: likertId, value: 1 },
        { questionId: likertId, value: 2 },
      ],
      [{ questionId: 'missing', unknown: true }],
      [{ questionId: likertId, unknown: true, value: 5 }],
    ])
      expect(() => validateQuestionnaire({ answers })).toThrow();
  });
  it('validates choices without accepting arbitrary or duplicate options', () => {
    expect(() =>
      validateQuestionnaire({ answers: [{ questionId: multiId, value: ['made_up'] }] }),
    ).toThrow();
    const option = multi?.rubric.type === 'multi_select' ? multi.rubric.options[0].value : '';
    expect(() =>
      validateQuestionnaire({ answers: [{ questionId: multiId, value: [option, option] }] }),
    ).toThrow();
    const emptySelection = validateQuestionnaire({ answers: [{ questionId: multiId, value: [] }] });
    expect(emptySelection.report.answers[0].answerLabel).toBe('None selected');
    expect(emptySelection.supplied[0].rawAnswer).toEqual({ type: 'multi_select', values: [] });
  });
});

describe('buyer-selected scope', () => {
  it('excludes AI model questions from a general supplier assessment and rejects injected answers', () => {
    const ai = intakeQuestions.find((q) => q.dimensionCode === 'D11');
    if (!ai) throw new Error('AI fixture missing');
    expect(() =>
      validateQuestionnaire({ profile: 'general', answers: [{ questionId: ai.id, value: 3 }] }),
    ).toThrow();
    const report = validateQuestionnaire({
      profile: 'general',
      context: { task: 'Build optical fibre routes', criteria: 'Team and deadlines' },
      answers: [{ questionId: likertId, value: 3 }],
    }).report;
    expect(report.totalCount).toBeLessThan(intakeQuestions.length);
    expect(report.gaps.every((q) => Number(q.dimensionCode.slice(1)) <= 10)).toBe(true);
    expect(report.context?.criteria).toBe('Team and deadlines');
  });
});
