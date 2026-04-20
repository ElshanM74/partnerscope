/**
 * 13 dimensions × 3 pillars × 4 risk bands.
 *
 * Source of truth: docs/partnerscope-spec/02_dimensions/13_dimensions.json
 *                  docs/partnerscope-spec/01_internal_logic/scoring_engine.md
 *
 * Do not modify weights without also bumping frameworkVersion in scoring.ts.
 */

import type { Dimension, Pillar, RiskBand, RiskBandDef } from './types.js';

// ────────────────────────────────────────────────────────────────
// Pillars
// ────────────────────────────────────────────────────────────────

export const PILLARS: readonly Pillar[] = [
  {
    id: 'A',
    name: 'Behavioral',
    description: 'Human and organizational behavior signals from the counterparty.',
    weightTotal: 25,
  },
  {
    id: 'B',
    name: 'Financial & Structural',
    description: 'Financial health, legal structure, operational delivery.',
    weightTotal: 30,
  },
  {
    id: 'C',
    name: 'AI & Compliance',
    description: 'Core differentiator — AI-specific controls + EU regulatory compliance.',
    weightTotal: 45,
  },
] as const;

// ────────────────────────────────────────────────────────────────
// Risk band definitions (canonical thresholds)
// ────────────────────────────────────────────────────────────────

export const RISK_BAND_DEFS: readonly RiskBandDef[] = [
  {
    band: 'HIGH',
    min: 0,
    max: 40,
    colorHex: '#ef4444',
    meaning: 'Do not onboard without remediation.',
    cta: 'Block contract; request specific evidence before proceeding.',
  },
  {
    band: 'MEDIUM',
    min: 41,
    max: 65,
    colorHex: '#f59e0b',
    meaning: 'Onboard with conditions and monitoring.',
    cta: 'Conditional approval; list remediation items before signing.',
  },
  {
    band: 'LOW',
    min: 66,
    max: 85,
    colorHex: '#10b981',
    meaning: 'Standard onboarding, quarterly review.',
    cta: 'Proceed; add to quarterly review list.',
  },
  {
    band: 'MINIMAL',
    min: 86,
    max: 100,
    colorHex: '#3b82f6',
    meaning: 'Standard contract, annual review.',
    cta: 'Proceed; reduce review frequency to annual.',
  },
] as const;

/**
 * Map a 0–100 composite score to its risk band.
 * Edge case (composite = exactly 40, 65, or 85): falls into the LOWER band (conservative).
 */
export function scoreToBand(score: number): RiskBand {
  if (!Number.isFinite(score)) throw new Error(`Invalid score: ${score}`);
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s <= 40) return 'HIGH';
  if (s <= 65) return 'MEDIUM';
  if (s <= 85) return 'LOW';
  return 'MINIMAL';
}

export function getBandDef(band: RiskBand): RiskBandDef {
  const def = RISK_BAND_DEFS.find((b) => b.band === band);
  if (!def) throw new Error(`Unknown band: ${band}`);
  return def;
}

// ────────────────────────────────────────────────────────────────
// Dimensions (13)
// ────────────────────────────────────────────────────────────────

export const DIMENSIONS: readonly Dimension[] = [
  // ── Pillar A — Behavioral (25%) ────────────────────────────
  {
    id: 1,
    code: 'D01',
    pillar: 'A',
    name: 'Accountability & Responsibility',
    shortDesc: 'Ownership of failures, reliability on commitments.',
    weight: 5,
    regulatoryAnchors: ['NIST AI RMF GOVERN 2'],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 3,
    evidenceRequestsPro: ['Organizational chart', 'RACI for AI systems'],
  },
  {
    id: 2,
    code: 'D02',
    pillar: 'A',
    name: 'Communication & Transparency',
    shortDesc: 'Responsiveness, documentation discipline, proactive disclosure.',
    weight: 5,
    regulatoryAnchors: ['NIST AI RMF GOVERN 4'],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 3,
    evidenceRequestsPro: ['Incident communication policy', 'SLA documentation'],
  },
  {
    id: 3,
    code: 'D03',
    pillar: 'A',
    name: 'Boundaries & Conflict Resolution',
    shortDesc: 'Ability to handle difficult conversations, escalation paths.',
    weight: 5,
    regulatoryAnchors: [],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 3,
    evidenceRequestsPro: ['Escalation matrix'],
  },
  {
    id: 4,
    code: 'D04',
    pillar: 'A',
    name: 'Consistency & Reliability',
    shortDesc: 'Pattern of completion, duration of past relationships.',
    weight: 5,
    regulatoryAnchors: [],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 3,
    evidenceRequestsPro: ['Client references (3)', 'Uptime reports'],
  },
  {
    id: 5,
    code: 'D05',
    pillar: 'A',
    name: 'Integrity & Ethics',
    shortDesc: 'Ethical track record, whistleblower protection, code of conduct.',
    weight: 5,
    regulatoryAnchors: ['EU AI Act Art. 15'],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 3,
    evidenceRequestsPro: ['Code of conduct', 'Ethics committee charter'],
  },

  // ── Pillar B — Financial & Structural (30%) ─────────────────
  {
    id: 6,
    code: 'D06',
    pillar: 'B',
    name: 'Financial Behavior',
    shortDesc: 'Financial transparency, spending discipline, debt management, runway.',
    weight: 6,
    regulatoryAnchors: ['DORA Art. 28'],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 4,
    evidenceRequestsPro: ['Latest audited financials', 'Cap table', 'Funding history'],
  },
  {
    id: 7,
    code: 'D07',
    pillar: 'B',
    name: 'Formal Agreements',
    shortDesc: 'Contract clarity, IP ownership, SLA enforceability, exit terms.',
    weight: 6,
    regulatoryAnchors: ['DORA Art. 30', 'GDPR Art. 28'],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 4,
    evidenceRequestsPro: ['Standard MSA/SaaS agreement', 'DPA template', 'SLA document'],
  },
  {
    id: 8,
    code: 'D08',
    pillar: 'B',
    name: 'Operational Delivery',
    shortDesc: 'Ability to execute, capacity, resilience, incident response.',
    weight: 6,
    regulatoryAnchors: ['DORA Art. 11', 'NIS2'],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 4,
    evidenceRequestsPro: ['BCP/DR plan', 'Last incident post-mortem', 'Pen-test summary'],
  },
  {
    id: 9,
    code: 'D09',
    pillar: 'B',
    name: 'Governance & Decision Rights',
    shortDesc: 'Board structure, UBO clarity, key-man risk, power asymmetry.',
    weight: 6,
    regulatoryAnchors: ['DORA Art. 30'],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 4,
    evidenceRequestsPro: ['UBO declaration', 'Board composition', 'Key-man insurance'],
  },
  {
    id: 10,
    code: 'D10',
    pillar: 'B',
    name: 'Exit & Continuity',
    shortDesc: 'Data portability, offboarding process, escrow, succession.',
    weight: 6,
    regulatoryAnchors: ['DORA Art. 30(3)'],
    requiredForTiers: ['starter', 'pro', 'enterprise'],
    questionsCount: 4,
    evidenceRequestsPro: ['Exit plan document', 'Source-code escrow (if applicable)'],
  },

  // ── Pillar C — AI & Compliance (45%) — core differentiator ──
  {
    id: 11,
    code: 'D11',
    pillar: 'C',
    name: 'Data Provenance',
    shortDesc: 'Training data lineage, consent basis, PII handling, data retention.',
    weight: 15,
    regulatoryAnchors: ['EU AI Act Art. 10', 'GDPR Art. 6', 'GDPR Art. 9'],
    requiredForTiers: ['free_snapshot', 'starter', 'pro', 'enterprise'],
    questionsCount: 6,
    evidenceRequestsPro: [
      'Training data inventory',
      'Consent mechanism documentation',
      'Data retention policy',
    ],
    automatedTestsTriggered: ['data_residency_trace', 'dark_web_leak_check'],
  },
  {
    id: 12,
    code: 'D12',
    pillar: 'C',
    name: 'Model Transparency',
    shortDesc: 'Model card, explainability, version control, change management.',
    weight: 15,
    regulatoryAnchors: ['EU AI Act Annex IV', 'EU AI Act Art. 13'],
    requiredForTiers: ['free_snapshot', 'starter', 'pro', 'enterprise'],
    questionsCount: 6,
    evidenceRequestsPro: ['Model card', 'System card', 'Evaluation reports', 'Bias audit results'],
    automatedTestsTriggered: ['redteam_prompt_injection', 'model_hosting_trace'],
  },
  {
    id: 13,
    code: 'D13',
    pillar: 'C',
    name: 'Regulatory Compliance',
    shortDesc: 'Annex III classification, GDPR DPA, sub-processors, Art. 73 incidents.',
    weight: 15,
    regulatoryAnchors: ['EU AI Act Annex III', 'EU AI Act Art. 73', 'GDPR Art. 28', 'DORA', 'NIS2'],
    requiredForTiers: ['free_snapshot', 'starter', 'pro', 'enterprise'],
    questionsCount: 8,
    evidenceRequestsPro: [
      'DPA signed',
      'Sub-processor list',
      'EU AI Act registration',
      'ISO 27001 / SOC 2',
      'NIS2 self-assessment',
      'DORA mapping (if in scope)',
    ],
    automatedTestsTriggered: ['sanctions_pep', 'company_registry', 'adverse_media'],
  },
] as const;

// ────────────────────────────────────────────────────────────────
// Lookups
// ────────────────────────────────────────────────────────────────

const DIMENSIONS_BY_CODE = new Map(DIMENSIONS.map((d) => [d.code, d]));
const DIMENSIONS_BY_ID = new Map(DIMENSIONS.map((d) => [d.id, d]));

export function getDimension(code: string): Dimension | undefined {
  return DIMENSIONS_BY_CODE.get(code as Dimension['code']);
}

export function getDimensionById(id: number): Dimension | undefined {
  return DIMENSIONS_BY_ID.get(id);
}

export function requireDimension(code: string): Dimension {
  const d = getDimension(code);
  if (!d) throw new Error(`Unknown dimension: ${code}`);
  return d;
}

// ────────────────────────────────────────────────────────────────
// Self-check (runs once on module load in dev; cheap)
// ────────────────────────────────────────────────────────────────

const TOTAL_WEIGHT = DIMENSIONS.reduce((s, d) => s + d.weight, 0);
if (TOTAL_WEIGHT !== 100) {
  // Throws at import time to prevent shipping a broken framework.
  throw new Error(
    `Invariant broken: dimension weights must sum to 100, got ${TOTAL_WEIGHT}. Check DIMENSIONS.`,
  );
}

const PILLAR_A_WEIGHT = DIMENSIONS.filter((d) => d.pillar === 'A').reduce(
  (s, d) => s + d.weight,
  0,
);
const PILLAR_B_WEIGHT = DIMENSIONS.filter((d) => d.pillar === 'B').reduce(
  (s, d) => s + d.weight,
  0,
);
const PILLAR_C_WEIGHT = DIMENSIONS.filter((d) => d.pillar === 'C').reduce(
  (s, d) => s + d.weight,
  0,
);
if (PILLAR_A_WEIGHT !== 25 || PILLAR_B_WEIGHT !== 30 || PILLAR_C_WEIGHT !== 45) {
  throw new Error(
    `Invariant broken: pillar weights must be A=25, B=30, C=45. Got A=${PILLAR_A_WEIGHT}, B=${PILLAR_B_WEIGHT}, C=${PILLAR_C_WEIGHT}.`,
  );
}
