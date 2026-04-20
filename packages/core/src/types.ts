/**
 * Shared domain types for PartnerScope.
 *
 * Source of truth: docs/partnerscope-spec/01_internal_logic/ +
 *                  docs/partnerscope-spec/02_dimensions/13_dimensions.json
 */

// ────────────────────────────────────────────────────────────────
// Tiers & pillars
// ────────────────────────────────────────────────────────────────

export const TIERS = ['free_snapshot', 'starter', 'pro', 'enterprise'] as const;
export type Tier = (typeof TIERS)[number];

export const PILLAR_IDS = ['A', 'B', 'C'] as const;
export type PillarId = (typeof PILLAR_IDS)[number];

export interface Pillar {
  id: PillarId;
  name: string;
  description: string;
  /** Sum of member-dimension weights. A=25, B=30, C=45. Must sum to 100. */
  weightTotal: number;
}

// ────────────────────────────────────────────────────────────────
// Risk bands
// ────────────────────────────────────────────────────────────────

export const RISK_BANDS = ['HIGH', 'MEDIUM', 'LOW', 'MINIMAL'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export interface RiskBandDef {
  band: RiskBand;
  min: number; // inclusive
  max: number; // inclusive
  colorHex: string;
  meaning: string;
  cta: string;
}

// ────────────────────────────────────────────────────────────────
// Dimensions
// ────────────────────────────────────────────────────────────────

export type DimensionCode =
  | 'D01'
  | 'D02'
  | 'D03'
  | 'D04'
  | 'D05'
  | 'D06'
  | 'D07'
  | 'D08'
  | 'D09'
  | 'D10'
  | 'D11'
  | 'D12'
  | 'D13';

export interface Dimension {
  id: number; // 1..13
  code: DimensionCode;
  pillar: PillarId;
  name: string;
  shortDesc: string;
  weight: number; // per spec: 5, 6, or 15
  regulatoryAnchors: string[];
  requiredForTiers: Tier[];
  questionsCount: number;
  evidenceRequestsPro: string[];
  automatedTestsTriggered?: string[];
}

// ────────────────────────────────────────────────────────────────
// Questions
// ────────────────────────────────────────────────────────────────

export type QuestionType =
  | 'likert'
  | 'multi_select'
  | 'single_select'
  | 'free_form'
  | 'document_upload';

export type TierGate = 'FS' | 'ST' | 'PR' | 'EN';

export interface LikertRubric {
  type: 'likert';
  anchor1: string;
  anchor5: string;
}

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Score delta when this option is selected. */
  weight?: number;
}

export interface MultiSelectRubric {
  type: 'multi_select';
  options: MultiSelectOption[];
  /** How to combine option weights into a 1-5 score. */
  aggregation?: 'sum_clamped_1_5' | 'count_hits' | 'analyst_review';
}

export interface SingleSelectRubric {
  type: 'single_select';
  options: MultiSelectOption[];
}

export interface FreeFormRubric {
  type: 'free_form';
  /** Must be analyst-scored for Pro/Enterprise; unscored for Starter. */
  analystScored: boolean;
}

export interface DocumentUploadRubric {
  type: 'document_upload';
  /** Evidence rubric (from questions_full.md §Evidence rubric). */
  criteria: ReadonlyArray<
    'authenticity' | 'completeness' | 'currency' | 'relevance' | 'exceptions'
  >;
}

export type ScoringRubric =
  | LikertRubric
  | MultiSelectRubric
  | SingleSelectRubric
  | FreeFormRubric
  | DocumentUploadRubric;

export interface Question {
  id: string; // Q01_1, Q11_3, etc. — must be stable across versions
  dimensionCode: DimensionCode;
  tierGates: TierGate[]; // tiers where this question is asked
  type: QuestionType;
  prompt: string;
  rubric: ScoringRubric;
  /** Optional internal hint for analysts / admin UI. */
  evidenceHint?: string;
}

// ────────────────────────────────────────────────────────────────
// Responses
// ────────────────────────────────────────────────────────────────

export type RawAnswer =
  | { type: 'likert'; value: 1 | 2 | 3 | 4 | 5 }
  | { type: 'multi_select'; values: string[] }
  | { type: 'single_select'; value: string }
  | { type: 'free_form'; text: string }
  | { type: 'document_upload'; documentId: string };

export interface Response {
  questionId: string;
  rawAnswer: RawAnswer;
  /** Computed 0–100 score; may be null while awaiting analyst review. */
  numericScore: number | null;
  analystNotes?: string;
}

// ────────────────────────────────────────────────────────────────
// Automated tests
// ────────────────────────────────────────────────────────────────

export type TestStatus = 'pass' | 'warn' | 'fail' | 'error';

export interface TestResult {
  testId: string;
  dimensionCode: DimensionCode;
  status: TestStatus;
  /** 0..100; null if status === 'error' (test could not execute). */
  score: number | null;
  evidenceUrl?: string;
  rawPayload?: unknown;
  runtimeMs?: number;
  executedAt: Date;
}

// ────────────────────────────────────────────────────────────────
// Evidence
// ────────────────────────────────────────────────────────────────

export type DocStatus = 'pending' | 'received' | 'verified' | 'rejected';

export interface EvidenceDocument {
  id: string;
  dimensionCode: DimensionCode;
  docType: 'DPA' | 'ISO27001' | 'SOC2' | 'ModelCard' | 'SBOM' | 'BCP' | 'IR_PLAN' | 'OTHER';
  filename: string;
  sha256: string;
  status: DocStatus;
  reviewerNotes?: string;
  uploadedAt: Date;
  reviewedAt?: Date;
}

// ────────────────────────────────────────────────────────────────
// Red team
// ────────────────────────────────────────────────────────────────

export type RedTeamCategory =
  | 'prompt_injection'
  | 'jailbreak'
  | 'pii_leakage'
  | 'bias'
  | 'robustness'
  | 'agentic';
export type RedTeamOutcome = 'blocked' | 'partial' | 'succeeded';
export type RedTeamSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RedTeamResult {
  payloadId: string;
  category: RedTeamCategory;
  subType?: string;
  outcome: RedTeamOutcome;
  severity: RedTeamSeverity;
  evidenceSanitized?: string;
  reviewedAt: Date;
}

// ────────────────────────────────────────────────────────────────
// Scoring outputs
// ────────────────────────────────────────────────────────────────

export interface DimensionScoreBreakdown {
  dimensionCode: DimensionCode;
  dimensionName: string;
  pillar: PillarId;
  weight: number;
  questionnaireScore: number; // 0..100
  automatedTestsScore: number; // 0..100
  evidenceBonus: number; // 0..100
  /** Tier-aware weighted combination. 0..100. */
  rawScore: number;
  /** After red-team multiplier (Enterprise only affects dims 11/12). 0..100. */
  score: number;
  band: RiskBand;
  findings: string[];
}

export interface RedFlag {
  code: string;
  dimensionCode: DimensionCode | 'GLOBAL';
  severity: 'blocker' | 'high' | 'medium';
  title: string;
  description: string;
  /** Regulatory citations, e.g., "EU AI Act Art. 10(2)". */
  references: string[];
}

export interface RemediationItem {
  dimensionCode: DimensionCode;
  severity: 'blocker' | 'high' | 'medium';
  action: string;
  bucket: 'before_signature' | 'within_30_days' | 'quarterly_monitoring';
  references: string[];
}

export interface ScoringResult {
  compositeScore: number; // 0..100 integer
  riskBand: RiskBand;
  /** Populated when AI-compliance cap (any D11/D12/D13 ≤ 40) is applied. */
  capReason: string | null;
  hardRedFlag: boolean;
  dimensionScores: DimensionScoreBreakdown[];
  redFlags: RedFlag[];
  remediation: RemediationItem[];
  /** For reproducibility — stored with every report. */
  scoringVersion: string;
  frameworkVersion: string;
}
