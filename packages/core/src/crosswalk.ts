/**
 * Regulatory crosswalk — maps each of the 13 dimensions to concrete articles
 * from EU AI Act / GDPR / DORA / NIS2 / ISO standards with a one-line rationale
 * suitable for report footnotes.
 *
 * Source anchors: INDEX.md §"Regulatory anchors" + 13_dimensions.json.
 */

import type { DimensionCode } from './types.js';

export interface CrosswalkEntry {
  euAiAct: readonly string[];
  dora: readonly string[];
  nis2: readonly string[];
  gdpr: readonly string[];
  iso: readonly string[];
  nist: readonly string[];
  rationale: string;
}

export const CROSSWALK: Readonly<Record<DimensionCode, CrosswalkEntry>> = {
  // ── Pillar A ──────────────────────────────────────────────────
  D01: {
    euAiAct: ['Art. 17 (Quality management system)', 'Art. 26 (Deployer obligations)'],
    dora: ['Art. 5 (ICT risk management framework)'],
    nis2: ['Art. 21(1) — governance responsibilities'],
    gdpr: ['Art. 5(2) (Accountability)'],
    iso: ['ISO/IEC 42001 §5.1', 'ISO/IEC 27001 §5.3'],
    nist: ['NIST AI RMF GOVERN 2'],
    rationale:
      'Accountability requires named owners, RACI, and reviewable escalation paths; regulators test for this first.',
  },
  D02: {
    euAiAct: ['Art. 13 (Transparency)', 'Art. 73 (Serious incident reporting)'],
    dora: ['Art. 14 (ICT-related incident communication)'],
    nis2: ['Art. 23 (Incident reporting obligations)'],
    gdpr: ['Art. 33 (Breach notification)', 'Art. 34 (Communication)'],
    iso: ['ISO/IEC 27001 A.6.8'],
    nist: ['NIST AI RMF GOVERN 4'],
    rationale:
      'Transparent, timely communication underpins Art. 73 15-day windows and GDPR 72-hour breach notice.',
  },
  D03: {
    euAiAct: [],
    dora: ['Art. 30(2)(g) (Dispute resolution)'],
    nis2: [],
    gdpr: [],
    iso: ['ISO/IEC 27001 A.5.24'],
    nist: [],
    rationale:
      'DORA contracts must specify dispute resolution; a vendor without such boundaries signals contract risk.',
  },
  D04: {
    euAiAct: ['Art. 15 (Accuracy, robustness)'],
    dora: ['Art. 11 (Response & recovery)'],
    nis2: ['Art. 21(2)(c) (Business continuity)'],
    gdpr: ['Art. 32(1)(b) (Integrity, availability)'],
    iso: ['ISO/IEC 27001 A.5.29-5.30', 'SOC 2 CC7'],
    nist: [],
    rationale:
      'Reliability and SLA attainment are the empirical signal of operational resilience. EU AI Act Art. 15 requires demonstrated accuracy and robustness.',
  },
  D05: {
    euAiAct: ['Art. 15 (Robustness and cybersecurity)', 'Art. 9(9) (Bias mitigation)'],
    dora: [],
    nis2: [],
    gdpr: ['Art. 5(1)(a) (Lawfulness, fairness, transparency)'],
    iso: ['ISO/IEC 42001 §6.1.4', 'ISO/IEC 27001 A.6.6'],
    nist: ['NIST AI RMF GOVERN 5'],
    rationale:
      'Ethics and integrity align with AI Act fairness/robustness and GDPR lawful-basis integrity. Code of conduct + independent audit are standard evidence.',
  },

  // ── Pillar B ──────────────────────────────────────────────────
  D06: {
    euAiAct: [],
    dora: ['Art. 28(4)(b) (Financial soundness of ICT third-party providers)'],
    nis2: [],
    gdpr: ['Art. 28(1) (Sufficient guarantees)'],
    iso: [],
    nist: [],
    rationale:
      'DORA Art. 28 requires financial due diligence on ICT TPPs. GDPR Art. 28(1) extends this to processors generally.',
  },
  D07: {
    euAiAct: ['Art. 25 (Responsibilities along value chain)'],
    dora: ['Art. 30 (Key contractual provisions)'],
    nis2: ['Art. 21(2)(d) (Supply chain security)'],
    gdpr: ['Art. 28 (Processor contracts)', 'Art. 46 (Transfer safeguards)'],
    iso: ['ISO/IEC 27001 A.5.19-5.20'],
    nist: [],
    rationale:
      'Contracts are the enforcement layer. DORA Art. 30 mandates specific clauses (audit rights, step-in, sub-processor approval).',
  },
  D08: {
    euAiAct: ['Art. 15 (Robustness)'],
    dora: ['Art. 11 (Response & recovery)', 'Art. 12 (Backup)'],
    nis2: ['Art. 21(2)(c) (BCP)', 'Art. 21(2)(e) (Vulnerability handling)'],
    gdpr: ['Art. 32 (Security of processing)'],
    iso: ['ISO/IEC 27001 A.5.29-5.30', 'SOC 2 CC7', 'BSI C5'],
    nist: [],
    rationale:
      'Operational resilience is the execution proof of the policy layer. MTTD/MTTR and BCP tests are the key evidence.',
  },
  D09: {
    euAiAct: ['Art. 16 (Obligations of providers)'],
    dora: ['Art. 28(1), Art. 30(2)(a)'],
    nis2: ['Art. 21(1)(a) (Governance)'],
    gdpr: ['Art. 27 (EU representative)', 'Art. 37 (DPO)'],
    iso: ['ISO/IEC 42001 §5', 'ISO/IEC 27001 A.5.2'],
    nist: [],
    rationale:
      'UBO clarity + key-person risk + board oversight determine whether accountability claims are enforceable.',
  },
  D10: {
    euAiAct: ['Art. 26(7) (Deployer cooperation)'],
    dora: ['Art. 30(3) (Exit strategies and transition periods)'],
    nis2: [],
    gdpr: ['Art. 20 (Data portability)', 'Art. 17 (Erasure)'],
    iso: ['ISO/IEC 27001 A.5.22'],
    nist: [],
    rationale:
      'DORA Art. 30(3) explicitly requires tested exit plans; GDPR Art. 20 mandates data portability. Escrow protects against vendor disappearance.',
  },

  // ── Pillar C — AI & Compliance (core differentiator) ──────────
  D11: {
    euAiAct: [
      'Art. 10 (Data and data governance)',
      'Art. 10(2)(a-g) (Training/validation/testing datasets quality)',
      'Annex IV §2(d) (Data requirements)',
    ],
    dora: [],
    nis2: [],
    gdpr: [
      'Art. 5(1)(b) (Purpose limitation)',
      'Art. 5(1)(c) (Data minimisation)',
      'Art. 6 (Lawful basis)',
      'Art. 9 (Special categories)',
    ],
    iso: ['ISO/IEC 42001 §7.2.4', 'ISO/IEC 27701 A.7.2'],
    nist: ['NIST AI RMF MAP 4', 'NIST AI RMF MEASURE 2.3'],
    rationale:
      'Data provenance is the most frequent AI Act violation vector: training data lineage, consent basis, retention, and data-subject rights.',
  },
  D12: {
    euAiAct: [
      'Art. 13 (Transparency / instructions for use)',
      'Annex IV (Technical documentation)',
      'Art. 15 (Accuracy, robustness, cybersecurity)',
    ],
    dora: [],
    nis2: [],
    gdpr: ['Art. 22 (Automated decision-making)'],
    iso: ['ISO/IEC 42001 §8', 'ISO/IEC 23894'],
    nist: ['NIST AI RMF MEASURE 2.5', 'NIST AI RMF MEASURE 2.7'],
    rationale:
      'Model cards, system cards, and evaluation reports satisfy Annex IV. Explainability supports Art. 14 human oversight and GDPR Art. 22.',
  },
  D13: {
    euAiAct: [
      'Annex III (High-risk classification)',
      'Art. 6 (Classification rules)',
      'Art. 72 (Post-market monitoring)',
      'Art. 73 (Serious incident reporting, 15-day)',
    ],
    dora: ['Art. 28-30 (ICT third-party risk)', 'Art. 29 (Concentration risk)'],
    nis2: ['Art. 21 (Cybersecurity risk management)', 'Art. 23 (Incident reporting)'],
    gdpr: ['Art. 28 (Processor)', 'Art. 30 (ROPA)', 'Art. 44-49 (Transfers)'],
    iso: ['ISO/IEC 27001 A.5.34', 'SOC 2 Type II'],
    nist: [],
    rationale:
      'Umbrella regulatory compliance dimension: Annex III classification, DPA, sub-processors, transfers, and incident SOPs.',
  },
} as const;

// Invariant: crosswalk covers every dimension
for (const code of [
  'D01',
  'D02',
  'D03',
  'D04',
  'D05',
  'D06',
  'D07',
  'D08',
  'D09',
  'D10',
  'D11',
  'D12',
  'D13',
] as const) {
  if (!(code in CROSSWALK)) throw new Error(`Crosswalk missing dimension ${code}`);
}
