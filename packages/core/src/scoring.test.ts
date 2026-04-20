import { describe, expect, it } from 'vitest';
import { DIMENSIONS, RISK_BAND_DEFS, scoreToBand } from './dimensions.js';
import { QUESTIONS, questionsForTier } from './questions.js';
import { calculateScoring, likertToScore } from './scoring.js';
import { TIER_ENTITLEMENTS } from './tiers.js';
import type { Response, TestResult } from './types.js';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-20T10:00:00Z');

/**
 * Synthesize a full answer set where every question in `tier` is answered
 * at a uniform Likert/score level.
 *   likert ∈ 1..5 → numericScore in {0, 25, 50, 75, 100}
 */
function synthResponses(
  tier: 'free_snapshot' | 'starter' | 'pro' | 'enterprise',
  likert: 1 | 2 | 3 | 4 | 5,
): Response[] {
  return questionsForTier(tier).map((q) => ({
    questionId: q.id,
    rawAnswer: { type: 'likert', value: likert },
    numericScore: likertToScore(likert),
  }));
}

function synthTests(score: number, dims?: readonly string[]): TestResult[] {
  const list: TestResult[] = [];
  const targets = dims ?? DIMENSIONS.map((d) => d.code);
  for (const code of targets) {
    list.push({
      testId: `SYN_${code}`,
      dimensionCode: code as never,
      status: score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail',
      score,
      executedAt: NOW,
    });
  }
  return list;
}

// ────────────────────────────────────────────────────────────────
// Invariants
// ────────────────────────────────────────────────────────────────

describe('dimension invariants', () => {
  it('13 dimensions total', () => {
    expect(DIMENSIONS).toHaveLength(13);
  });

  it('weights sum to 100', () => {
    const sum = DIMENSIONS.reduce((s, d) => s + d.weight, 0);
    expect(sum).toBe(100);
  });

  it('pillar weights match spec (A=25, B=30, C=45)', () => {
    const byPillar = { A: 0, B: 0, C: 0 };
    for (const d of DIMENSIONS) byPillar[d.pillar] += d.weight;
    expect(byPillar).toEqual({ A: 25, B: 30, C: 45 });
  });

  it('AI/Compliance dimensions each weigh 15', () => {
    expect(DIMENSIONS.find((d) => d.code === 'D11')?.weight).toBe(15);
    expect(DIMENSIONS.find((d) => d.code === 'D12')?.weight).toBe(15);
    expect(DIMENSIONS.find((d) => d.code === 'D13')?.weight).toBe(15);
  });

  it('all questions map to a real dimension', () => {
    const codes = new Set(DIMENSIONS.map((d) => d.code));
    for (const q of QUESTIONS) {
      expect(codes.has(q.dimensionCode)).toBe(true);
    }
  });

  it('risk band thresholds cover 0-100 without gaps', () => {
    // 0 → HIGH, 40 → HIGH (edge conservative), 41 → MEDIUM, 65 → MEDIUM,
    // 66 → LOW, 85 → LOW, 86 → MINIMAL, 100 → MINIMAL.
    expect(scoreToBand(0)).toBe('HIGH');
    expect(scoreToBand(40)).toBe('HIGH');
    expect(scoreToBand(41)).toBe('MEDIUM');
    expect(scoreToBand(65)).toBe('MEDIUM');
    expect(scoreToBand(66)).toBe('LOW');
    expect(scoreToBand(85)).toBe('LOW');
    expect(scoreToBand(86)).toBe('MINIMAL');
    expect(scoreToBand(100)).toBe('MINIMAL');
  });

  it('risk bands are continuous and non-overlapping', () => {
    const sorted = [...RISK_BAND_DEFS].sort((a, b) => a.min - b.min);
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      if (!cur || !next) throw new Error('unreachable');
      expect(next.min).toBe(cur.max + 1);
    }
    expect(sorted[0]?.min).toBe(0);
    expect(sorted[sorted.length - 1]?.max).toBe(100);
  });
});

// ────────────────────────────────────────────────────────────────
// Scoring engine — formula behavior
// ────────────────────────────────────────────────────────────────

describe('calculateScoring — Starter tier', () => {
  it('perfect answers + perfect tests → 100/MINIMAL', () => {
    const result = calculateScoring({
      tier: 'starter',
      responses: synthResponses('starter', 5),
      testResults: synthTests(100),
    });
    expect(result.compositeScore).toBe(100);
    expect(result.riskBand).toBe('MINIMAL');
    expect(result.capReason).toBeNull();
    expect(result.hardRedFlag).toBe(false);
  });

  it('all Likert=1 + 0 tests → 0/HIGH + blockers on AI dims', () => {
    const result = calculateScoring({
      tier: 'starter',
      responses: synthResponses('starter', 1),
      testResults: synthTests(0),
    });
    expect(result.compositeScore).toBe(0);
    expect(result.riskBand).toBe('HIGH');
    // D11/D12/D13 all ≤ 40 → blocker flags
    expect(result.hardRedFlag).toBe(true);
  });

  it('Starter uses 0.7 questionnaire + 0.3 tests (no evidence bonus)', () => {
    // Likert=4 → 75, tests=100 → dim_raw = 0.7*75 + 0.3*100 = 82.5
    const result = calculateScoring({
      tier: 'starter',
      responses: synthResponses('starter', 4),
      testResults: synthTests(100),
    });
    // Composite ≈ 82.5 → LOW (66-85). Allow ±1 for rounding.
    expect(result.compositeScore).toBeGreaterThanOrEqual(82);
    expect(result.compositeScore).toBeLessThanOrEqual(83);
    expect(result.riskBand).toBe('LOW');
  });
});

describe('calculateScoring — Pro tier', () => {
  it('uses 0.6 + 0.3 + 0.1 with evidence bonus', () => {
    // Likert=3 (→50), tests=60, evidence=100 everywhere
    // dim_raw = 0.6*50 + 0.3*60 + 0.1*100 = 30 + 18 + 10 = 58 → MEDIUM
    const ev: Record<string, number> = {};
    for (const d of DIMENSIONS) ev[d.code] = 100;
    const result = calculateScoring({
      tier: 'pro',
      responses: synthResponses('pro', 3),
      testResults: synthTests(60),
      evidenceBonusByDimension: ev,
    });
    expect(result.compositeScore).toBeGreaterThanOrEqual(57);
    expect(result.compositeScore).toBeLessThanOrEqual(59);
    expect(result.riskBand).toBe('MEDIUM');
  });

  it('AI-compliance cap: D11 score 40 forces composite ≤ 65', () => {
    // Everything else perfect; D11 questions all = 1 (→0) but tests=0 too → D11_raw=0
    const responses = synthResponses('pro', 5).map((r) => {
      if (r.questionId.startsWith('Q11')) {
        return { ...r, rawAnswer: { type: 'likert', value: 1 as const }, numericScore: 0 };
      }
      return r;
    });
    const tests = synthTests(100).map((t) =>
      t.dimensionCode === 'D11' ? { ...t, score: 0, status: 'fail' as const } : t,
    );
    const ev: Record<string, number> = {};
    for (const d of DIMENSIONS) ev[d.code] = 100;
    // D11 without evidence = 0
    ev.D11 = 0;

    const result = calculateScoring({
      tier: 'pro',
      responses,
      testResults: tests,
      evidenceBonusByDimension: ev,
    });
    expect(result.compositeScore).toBeLessThanOrEqual(65);
    expect(result.capReason).toMatch(/AI-compliance cap/i);
    // D11 must be in red flags as blocker
    const d11flag = result.redFlags.find((f) => f.dimensionCode === 'D11');
    expect(d11flag?.severity).toBe('blocker');
  });
});

describe('calculateScoring — Enterprise red-team modifier', () => {
  it('0 critical findings → no multiplier', () => {
    const ev: Record<string, number> = {};
    for (const d of DIMENSIONS) ev[d.code] = 100;
    const result = calculateScoring({
      tier: 'enterprise',
      responses: synthResponses('enterprise', 5),
      testResults: synthTests(100),
      evidenceBonusByDimension: ev,
      redTeamResults: [],
    });
    expect(result.compositeScore).toBe(100);
  });

  it('3 critical findings → D11/D12 multiplied by 0.7', () => {
    const ev: Record<string, number> = {};
    for (const d of DIMENSIONS) ev[d.code] = 100;
    const result = calculateScoring({
      tier: 'enterprise',
      responses: synthResponses('enterprise', 5),
      testResults: synthTests(100),
      evidenceBonusByDimension: ev,
      redTeamResults: [
        {
          payloadId: 'p1',
          category: 'prompt_injection',
          outcome: 'succeeded',
          severity: 'critical',
          reviewedAt: NOW,
        },
        {
          payloadId: 'p2',
          category: 'jailbreak',
          outcome: 'succeeded',
          severity: 'critical',
          reviewedAt: NOW,
        },
        {
          payloadId: 'p3',
          category: 'pii_leakage',
          outcome: 'succeeded',
          severity: 'critical',
          reviewedAt: NOW,
        },
      ],
    });
    const d11 = result.dimensionScores.find((d) => d.dimensionCode === 'D11');
    const d12 = result.dimensionScores.find((d) => d.dimensionCode === 'D12');
    expect(d11?.rawScore).toBe(100);
    expect(d11?.score).toBe(70); // 100 * 0.7
    expect(d12?.score).toBe(70);
    // Other dims untouched
    const d01 = result.dimensionScores.find((d) => d.dimensionCode === 'D01');
    expect(d01?.score).toBe(100);
    // Hard red flag because critical red-team succeeded
    expect(result.hardRedFlag).toBe(true);
  });

  it('6+ critical findings → 0.5 multiplier', () => {
    const rt = Array.from({ length: 7 }, (_, i) => ({
      payloadId: `p${i}`,
      category: 'prompt_injection' as const,
      outcome: 'succeeded' as const,
      severity: 'critical' as const,
      reviewedAt: NOW,
    }));
    const ev: Record<string, number> = {};
    for (const d of DIMENSIONS) ev[d.code] = 100;
    const result = calculateScoring({
      tier: 'enterprise',
      responses: synthResponses('enterprise', 5),
      testResults: synthTests(100),
      evidenceBonusByDimension: ev,
      redTeamResults: rt,
    });
    const d11 = result.dimensionScores.find((d) => d.dimensionCode === 'D11');
    expect(d11?.score).toBe(50);
  });
});

describe('edge cases', () => {
  it('empty responses → score 0 (no data)', () => {
    const result = calculateScoring({ tier: 'pro', responses: [] });
    expect(result.compositeScore).toBe(0);
    expect(result.riskBand).toBe('HIGH');
  });

  it('tier entitlements are internally consistent', () => {
    for (const e of Object.values(TIER_ENTITLEMENTS)) {
      expect(e.priceEur).toBeGreaterThanOrEqual(0);
      if (e.tier === 'enterprise') {
        expect(e.minVendors).toBe(15);
        expect(e.continuousMonitoring).toBe(true);
        expect(e.slaPriorityHours).toBe(24);
      }
    }
  });
});
