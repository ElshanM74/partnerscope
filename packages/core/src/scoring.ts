/**
 * Scoring engine — pure functions, deterministic, side-effect-free.
 *
 * Source of truth: docs/partnerscope-spec/01_internal_logic/scoring_engine.md
 *
 * Formula per dimension (D):
 *   D_raw = 0.6 × questionnaire + 0.3 × automated_tests + 0.1 × evidence_bonus   (Pro/Ent)
 *   D_raw = 0.7 × questionnaire + 0.3 × automated_tests                          (Starter — no evidence bonus)
 *
 * Enterprise red-team modifier applies to dimensions 11 and 12.
 *
 * Composite = Σ (D_i.score × D_i.weight) / 100
 *
 * AI-compliance cap: if any of D11/D12/D13 ≤ 40, composite is capped at 65.
 *
 * Insufficient data: if dimension skipped > 10% → excluded from composite, weight redistributed.
 */

import { DIMENSIONS, scoreToBand } from './dimensions.js';
import { questionsForTier } from './questions.js';
import type {
  DimensionCode,
  DimensionScoreBreakdown,
  RedFlag,
  RedTeamResult,
  RemediationItem,
  Response,
  ScoringResult,
  TestResult,
  Tier,
} from './types.js';

export const SCORING_VERSION = '1.0.0';
export const FRAMEWORK_VERSION = '13.0';

// ────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────

interface ScoringConfig {
  /** Fractions of the dimension score (must sum to 1). Tier-aware. */
  weights: {
    questionnaire: number;
    automatedTests: number;
    evidenceBonus: number;
  };
}

const CONFIG_BY_TIER: Record<Tier, ScoringConfig> = {
  free_snapshot: {
    // Snapshot scores only D11/D12/D13 from questionnaire; no tests, no evidence.
    weights: { questionnaire: 1.0, automatedTests: 0.0, evidenceBonus: 0.0 },
  },
  starter: {
    // Starter: questionnaire + automated only, no evidence review.
    weights: { questionnaire: 0.7, automatedTests: 0.3, evidenceBonus: 0.0 },
  },
  pro: {
    weights: { questionnaire: 0.6, automatedTests: 0.3, evidenceBonus: 0.1 },
  },
  enterprise: {
    weights: { questionnaire: 0.6, automatedTests: 0.3, evidenceBonus: 0.1 },
  },
};

/** Minimum fraction of answered questions per dimension (else INSUFFICIENT_DATA). */
const MIN_ANSWERED_FRACTION = 0.9;

/** AI-compliance cap threshold. */
const AI_COMP_CAP_THRESHOLD = 40;
const AI_COMP_CAP_VALUE = 65;
const AI_COMP_DIMS: DimensionCode[] = ['D11', 'D12', 'D13'];

/** Red-team multiplier — applies to D11/D12 in Enterprise. */
const RED_TEAM_MULTIPLIERS: Array<{ maxCritical: number; multiplier: number }> = [
  { maxCritical: 0, multiplier: 1.0 },
  { maxCritical: 2, multiplier: 0.85 },
  { maxCritical: 5, multiplier: 0.7 },
  { maxCritical: Number.POSITIVE_INFINITY, multiplier: 0.5 },
];

// ────────────────────────────────────────────────────────────────
// Inputs
// ────────────────────────────────────────────────────────────────

export interface ScoringInput {
  tier: Tier;
  responses: readonly Response[];
  testResults?: readonly TestResult[];
  /**
   * Evidence bonus per dimension (0–100). Analyst-verified docs → 100; received-
   * but-unverified → 50; missing → 0.
   */
  evidenceBonusByDimension?: Partial<Record<DimensionCode, number>>;
  /** Enterprise red-team findings (applied to D11/D12 only). */
  redTeamResults?: readonly RedTeamResult[];
  /** If a response's questionId dimension-map isn't embedded in Response, provide here. */
  questionToDimension?: Map<string, DimensionCode>;
  /** Total questions per dimension (used to compute answered-fraction). */
  expectedQuestionsPerDimension?: Partial<Record<DimensionCode, number>>;
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

export function calculateScoring(input: ScoringInput): ScoringResult {
  const config = CONFIG_BY_TIER[input.tier];
  if (!config) throw new Error(`Unknown tier: ${input.tier}`);

  const criticalRedTeamCount = countCriticalRedTeam(input.redTeamResults);
  const applyRedTeam = input.tier === 'enterprise' && (input.redTeamResults?.length ?? 0) > 0;

  // Tier-aware expected question counts (how many questions are gated in at
  // this tier, per dimension). This is the correct denominator for the
  // INSUFFICIENT_DATA check — `dim.questionsCount` is the Enterprise total.
  const tierQuestions = questionsForTier(input.tier);
  const tierExpectedByDim = new Map<DimensionCode, number>();
  for (const q of tierQuestions) {
    tierExpectedByDim.set(q.dimensionCode, (tierExpectedByDim.get(q.dimensionCode) ?? 0) + 1);
  }

  // 1. Per-dimension breakdown
  const breakdowns: DimensionScoreBreakdown[] = [];
  const insufficient = new Set<DimensionCode>();

  for (const dim of DIMENSIONS) {
    const dimResponses = input.responses.filter((r) => responseDim(r, input) === dim.code);
    const dimTests = (input.testResults ?? []).filter((t) => t.dimensionCode === dim.code);

    const expected =
      input.expectedQuestionsPerDimension?.[dim.code] ?? tierExpectedByDim.get(dim.code) ?? 0;
    const answered = dimResponses.filter((r) => r.numericScore !== null).length;

    // Dimension is out of tier scope (e.g., D01 at free_snapshot) → exclude entirely.
    if (expected === 0 && dimResponses.length === 0 && dimTests.length === 0) {
      continue;
    }

    // INSUFFICIENT_DATA guard (ignored for free_snapshot because its FS set is tiny)
    if (input.tier !== 'free_snapshot' && expected > 0) {
      const fraction = answered / expected;
      if (fraction < MIN_ANSWERED_FRACTION) {
        insufficient.add(dim.code);
        continue;
      }
    }

    const questionnaireScore =
      dimResponses.length > 0 ? avg(dimResponses.map((r) => r.numericScore ?? 0)) : 0;
    const automatedTestsScore = dimTests.length > 0 ? avg(dimTests.map((t) => t.score ?? 0)) : 0;
    const evidenceBonus = input.evidenceBonusByDimension?.[dim.code] ?? 0;

    const w = config.weights;
    const rawScore = clamp0to100(
      w.questionnaire * questionnaireScore +
        w.automatedTests * automatedTestsScore +
        w.evidenceBonus * evidenceBonus,
    );

    // Red-team multiplier (Enterprise; D11/D12 only)
    let score = rawScore;
    if (applyRedTeam && (dim.code === 'D11' || dim.code === 'D12')) {
      const mult = redTeamMultiplier(criticalRedTeamCount);
      score = clamp0to100(rawScore * mult);
    }

    breakdowns.push({
      dimensionCode: dim.code,
      dimensionName: dim.name,
      pillar: dim.pillar,
      weight: dim.weight,
      questionnaireScore: round(questionnaireScore),
      automatedTestsScore: round(automatedTestsScore),
      evidenceBonus: round(evidenceBonus),
      rawScore: round(rawScore),
      score: round(score),
      band: scoreToBand(score),
      findings: [],
    });
  }

  // 2. Composite with weight redistribution for INSUFFICIENT_DATA dims.
  //    Normalize by effective weight sum so the result still scales to 0..100
  //    even when some dimensions were dropped.
  const effectiveWeightSum = breakdowns.reduce((s, b) => s + b.weight, 0);
  const normalized =
    effectiveWeightSum > 0
      ? breakdowns.reduce((s, b) => s + (b.score * b.weight) / effectiveWeightSum, 0)
      : 0;

  // 3. AI-compliance cap
  let capReason: string | null = null;
  let compositeFinal = Math.round(normalized);
  for (const code of AI_COMP_DIMS) {
    const b = breakdowns.find((x) => x.dimensionCode === code);
    if (b && b.score <= AI_COMP_CAP_THRESHOLD && compositeFinal > AI_COMP_CAP_VALUE) {
      compositeFinal = AI_COMP_CAP_VALUE;
      capReason = `AI-compliance cap: dimension ${code} scored ${b.score} (≤ ${AI_COMP_CAP_THRESHOLD}); composite capped at ${AI_COMP_CAP_VALUE}.`;
      break;
    }
  }

  compositeFinal = Math.max(0, Math.min(100, Math.round(compositeFinal)));
  const riskBand = scoreToBand(compositeFinal);

  // 4. Red flags
  const redFlags = generateRedFlags({
    breakdowns,
    testResults: input.testResults ?? [],
    redTeamResults: input.redTeamResults ?? [],
    insufficient,
  });
  const hardRedFlag = redFlags.some((r) => r.severity === 'blocker');

  // 5. Remediation
  const remediation = generateRemediation(breakdowns, redFlags);

  return {
    compositeScore: compositeFinal,
    riskBand,
    capReason,
    hardRedFlag,
    dimensionScores: breakdowns,
    redFlags,
    remediation,
    scoringVersion: SCORING_VERSION,
    frameworkVersion: FRAMEWORK_VERSION,
  };
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Map a Likert 1-5 to a 0..100 score.
 *   1 → 0, 2 → 25, 3 → 50, 4 → 75, 5 → 100.
 */
export function likertToScore(value: 1 | 2 | 3 | 4 | 5): number {
  return (value - 1) * 25;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sum = nums.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  return sum / nums.length;
}

function clamp0to100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function round(n: number): number {
  return Math.round(n);
}

function responseDim(r: Response, input: ScoringInput): DimensionCode | null {
  if (input.questionToDimension) {
    return input.questionToDimension.get(r.questionId) ?? null;
  }
  // Fallback: parse Q<NN>_<M> → D<NN>
  const match = /^Q(\d{2})_\d+$/.exec(r.questionId);
  if (match?.[1]) return `D${match[1]}` as DimensionCode;
  return null;
}

function countCriticalRedTeam(results: readonly RedTeamResult[] | undefined): number {
  if (!results) return 0;
  return results.filter((r) => r.severity === 'critical' && r.outcome === 'succeeded').length;
}

function redTeamMultiplier(criticalCount: number): number {
  for (const row of RED_TEAM_MULTIPLIERS) {
    if (criticalCount <= row.maxCritical) return row.multiplier;
  }
  // unreachable due to Infinity row
  return 0.5;
}

// ────────────────────────────────────────────────────────────────
// Red-flag generation
// ────────────────────────────────────────────────────────────────

interface RedFlagContext {
  breakdowns: DimensionScoreBreakdown[];
  testResults: readonly TestResult[];
  redTeamResults: readonly RedTeamResult[];
  insufficient: Set<DimensionCode>;
}

function generateRedFlags(ctx: RedFlagContext): RedFlag[] {
  const flags: RedFlag[] = [];

  for (const b of ctx.breakdowns) {
    if (b.score <= AI_COMP_CAP_THRESHOLD) {
      const sev: RedFlag['severity'] = AI_COMP_DIMS.includes(b.dimensionCode) ? 'blocker' : 'high';
      flags.push({
        code: `LOW_DIM_${b.dimensionCode}`,
        dimensionCode: b.dimensionCode,
        severity: sev,
        title: `${b.dimensionName} scored ${b.score}/100 (HIGH risk band)`,
        description: `Dimension below remediation threshold (≤${AI_COMP_CAP_THRESHOLD}). ${
          AI_COMP_DIMS.includes(b.dimensionCode)
            ? 'Blocks contract signature until remediated; enforces composite cap at 65.'
            : 'Remediation required before onboarding.'
        }`,
        references: DIMENSIONS.find((d) => d.code === b.dimensionCode)?.regulatoryAnchors ?? [],
      });
    }
  }

  for (const t of ctx.testResults) {
    if (t.status === 'fail' && (t.score ?? 0) === 0) {
      flags.push({
        code: `TEST_FAIL_${t.testId}`,
        dimensionCode: t.dimensionCode,
        severity: 'blocker',
        title: `Automated test ${t.testId} hard-failed`,
        description:
          'Test reported critical finding (e.g., sanctions hit, expired cert, known breach).',
        references: [],
      });
    }
  }

  for (const r of ctx.redTeamResults) {
    if (r.severity === 'critical' && r.outcome === 'succeeded') {
      flags.push({
        code: `REDTEAM_CRIT_${r.payloadId}`,
        dimensionCode:
          r.category === 'prompt_injection' || r.category === 'jailbreak' ? 'D12' : 'D11',
        severity: 'blocker',
        title: `AI red-team: critical ${r.category} succeeded`,
        description: r.evidenceSanitized ?? 'Sanitized evidence captured in run artifacts.',
        references: ['OWASP LLM Top 10', 'MITRE ATLAS'],
      });
    }
  }

  for (const code of ctx.insufficient) {
    flags.push({
      code: `INSUFFICIENT_${code}`,
      dimensionCode: code,
      severity: 'medium',
      title: `Insufficient data for ${code}`,
      description: `Fewer than ${Math.round(MIN_ANSWERED_FRACTION * 100)}% of required questions answered. Dimension excluded from composite; weight redistributed.`,
      references: [],
    });
  }

  return flags;
}

// ────────────────────────────────────────────────────────────────
// Remediation bucketing (per scoring_engine.md §8)
// ────────────────────────────────────────────────────────────────

function generateRemediation(
  breakdowns: DimensionScoreBreakdown[],
  flags: RedFlag[],
): RemediationItem[] {
  const items: RemediationItem[] = [];

  for (const flag of flags) {
    if (flag.dimensionCode === 'GLOBAL') continue;
    const dim = DIMENSIONS.find((d) => d.code === flag.dimensionCode);
    if (!dim) continue;
    const bucket = chooseBucket(flag.severity);
    items.push({
      dimensionCode: flag.dimensionCode,
      severity: flag.severity,
      action: `Remediate: ${flag.title}.`,
      bucket,
      references: flag.references,
    });
  }

  // Add low-cost improvements for MEDIUM-band dimensions (41-65)
  for (const b of breakdowns) {
    if (b.band === 'MEDIUM') {
      items.push({
        dimensionCode: b.dimensionCode,
        severity: 'medium',
        action: `Improve ${b.dimensionName}: currently ${b.score}/100. Target LOW band (≥66).`,
        bucket: 'within_30_days',
        references: DIMENSIONS.find((d) => d.code === b.dimensionCode)?.regulatoryAnchors ?? [],
      });
    }
  }

  return items;
}

function chooseBucket(severity: RedFlag['severity']): RemediationItem['bucket'] {
  switch (severity) {
    case 'blocker':
      return 'before_signature';
    case 'high':
      return 'before_signature';
    case 'medium':
      return 'within_30_days';
  }
}
