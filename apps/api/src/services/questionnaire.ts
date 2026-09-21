import { DIMENSIONS, questionsForTier } from '@partnerscope/core';
import { z } from 'zod';

export const profiles = z.enum(['general', 'ai']);
export function questionsForProfile(profile: 'general' | 'ai') {
  return profile === 'ai'
    ? intakeQuestions
    : intakeQuestions.filter(
        (q) => Number(q.dimensionCode.slice(1)) <= 10 && !/\bAI\b|AI-generated/i.test(q.prompt),
      );
}
export const intakeQuestions = questionsForTier('pro').filter((q) =>
  ['likert', 'single_select', 'multi_select'].includes(q.type),
);
const byId = new Map(intakeQuestions.map((q) => [q.id, q]));
const answerSchema = z.union([
  z.object({ questionId: z.string(), unknown: z.literal(true) }).strict(),
  z
    .object({
      questionId: z.string(),
      value: z.union([z.number(), z.string(), z.array(z.string())]),
    })
    .strict(),
]);
const requestSchema = z
  .object({
    answers: z.array(answerSchema).min(1).max(intakeQuestions.length),
    profile: profiles.default('ai'),
    context: z
      .object({ task: z.string().trim().max(2000), criteria: z.string().trim().max(1000) })
      .optional(),
  })
  .strict();

export function questionnaireCatalogue(profile: 'general' | 'ai' = 'ai') {
  const selected = questionsForProfile(profile);
  return {
    profile,
    questions: selected,
    dimensions: DIMENSIONS.map((d) => ({
      code: d.code,
      name: d.name,
      questions: selected.filter((q) => q.dimensionCode === d.code),
    })).filter((d) => d.questions.length > 0),
  };
}

export function validateQuestionnaire(body: unknown) {
  const input = requestSchema.parse(body);
  const selected = questionsForProfile(input.profile);
  const allowed = new Set(selected.map((q) => q.id));
  const seen = new Set<string>();
  const answers = input.answers.map((answer) => {
    const q = byId.get(answer.questionId);
    if (!q || !allowed.has(q.id) || seen.has(answer.questionId))
      throw new Error('invalid_question');
    seen.add(q.id);
    const base = { questionId: q.id, prompt: q.prompt, dimensionCode: q.dimensionCode };
    if ('unknown' in answer)
      return {
        ...base,
        status: 'unknown' as const,
        answerLabel: 'Unknown',
        rawAnswer: { unknown: true },
      };
    const value = answer.value;
    let label: string;
    if (q.rubric.type === 'likert') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5)
        throw new Error('invalid_value');
      label = `${value}/5`;
    } else if (q.rubric.type === 'single_select') {
      const option = q.rubric.options.find((o) => o.value === value);
      if (!option) throw new Error('invalid_value');
      label = option.label;
    } else if (q.rubric.type === 'multi_select') {
      if (!Array.isArray(value) || new Set(value).size !== value.length)
        throw new Error('invalid_value');
      const options = q.rubric.options;
      label =
        value
          .map((v) => {
            const option = options.find((o) => o.value === v);
            if (!option) throw new Error('invalid_value');
            return option.label;
          })
          .join('; ') || 'None selected';
    } else throw new Error('unsupported_question');
    return {
      ...base,
      status: 'answered' as const,
      answerLabel: label,
      rawAnswer:
        q.type === 'multi_select'
          ? { type: 'multi_select', values: value as string[] }
          : { type: q.type, value },
    };
  });
  return {
    supplied: answers,
    report: {
      source: 'questionnaire' as const,
      profile: input.profile,
      context: input.context ?? null,
      answeredCount: answers.filter((a) => a.status === 'answered').length,
      unknownCount: answers.filter((a) => a.status === 'unknown').length,
      totalCount: selected.length,
      answers: answers.map(({ rawAnswer: _raw, ...answer }) => answer),
      gaps: selected
        .filter(
          (q) =>
            !seen.has(q.id) || answers.some((a) => a.questionId === q.id && a.status === 'unknown'),
        )
        .map((q) => ({ questionId: q.id, prompt: q.prompt, dimensionCode: q.dimensionCode })),
    },
  };
}
