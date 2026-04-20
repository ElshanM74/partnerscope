/**
 * Question bank — 55 questions across 13 dimensions.
 *
 * Source of truth: docs/partnerscope-spec/02_dimensions/questions_full.md
 * Framework version: 13.0
 *
 * NOTE on the 55 vs 78 discrepancy:
 *   The narrative spec states "Pro = 78 questions" but the documented question
 *   bank lists 55 (3×5 behavioral + 4×5 financial + 6+6+8 AI/compliance).
 *   This implementation seeds the 55 questions that are documented. The
 *   remaining ~23 Pro-only questions are expected to be added in a v1.1 spec
 *   revision. Tracked in ISSUES.md.
 *
 * Question IDs are STABLE. Never renumber — only deprecate.
 * Format: `Q<dim:02d>_<seq:d>` → Q01_1, Q11_3, Q13_8.
 */

import type { DimensionCode, Question, TierGate } from './types.js';

/** Short alias for building tier gate arrays. */
const FS_ST_PR_EN: TierGate[] = ['FS', 'ST', 'PR', 'EN'];
const ST_PR_EN: TierGate[] = ['ST', 'PR', 'EN'];
const PR_EN: TierGate[] = ['PR', 'EN'];

// ────────────────────────────────────────────────────────────────
// D01 — Accountability & Responsibility (3)
// ────────────────────────────────────────────────────────────────

const D01: Question[] = [
  {
    id: 'Q01_1',
    dimensionCode: 'D01',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'The vendor formally documents ownership for every material delivery commitment (tech lead, PM, account exec).',
    rubric: {
      type: 'likert',
      anchor1: 'No documentation; unclear who owns what.',
      anchor5: 'RACI matrix exists, signed, reviewed quarterly.',
    },
  },
  {
    id: 'Q01_2',
    dimensionCode: 'D01',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'When something goes wrong, the vendor acknowledges failure and publishes a root cause analysis within 30 days.',
    rubric: {
      type: 'likert',
      anchor1: 'Deflects blame; no post-mortems.',
      anchor5: 'Public RCAs for every SEV-1 incident.',
    },
  },
  {
    id: 'Q01_3',
    dimensionCode: 'D01',
    tierGates: PR_EN,
    type: 'multi_select',
    prompt: 'Which of these accountability mechanisms does the vendor operate?',
    rubric: {
      type: 'multi_select',
      aggregation: 'count_hits',
      options: [
        { value: 'exec_sponsor', label: 'Executive sponsor for each major client', weight: 1 },
        { value: 'sla_penalties', label: 'Published SLA with financial penalties', weight: 1 },
        { value: 'escalation_matrix', label: 'Documented escalation matrix', weight: 1 },
        { value: 'qbr', label: 'Quarterly business reviews (QBR)', weight: 1 },
        { value: 'board_risk_committee', label: 'Board-level risk committee', weight: 1 },
      ],
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D02 — Communication & Transparency (3)
// ────────────────────────────────────────────────────────────────

const D02: Question[] = [
  {
    id: 'Q02_1',
    dimensionCode: 'D02',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'The vendor responds to material questions in writing within 2 business days.',
    rubric: {
      type: 'likert',
      anchor1: 'Frequently delays or avoids written response.',
      anchor5: 'Consistent written follow-ups within 24h.',
    },
  },
  {
    id: 'Q02_2',
    dimensionCode: 'D02',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'The vendor proactively discloses changes (ownership, leadership, sub-processors, pricing) before they take effect.',
    rubric: {
      type: 'likert',
      anchor1: 'Learn via press or after the fact.',
      anchor5: '30+ day advance notice with written communication.',
    },
  },
  {
    id: 'Q02_3',
    dimensionCode: 'D02',
    tierGates: PR_EN,
    type: 'likert',
    prompt:
      'When asked for documentation (certifications, DPAs, reports), the vendor provides within 5 business days.',
    rubric: {
      type: 'likert',
      anchor1: 'Slow or partial; missing documents.',
      anchor5: 'Immediate access via shared repository.',
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D03 — Boundaries & Conflict Resolution (3)
// ────────────────────────────────────────────────────────────────

const D03: Question[] = [
  {
    id: 'Q03_1',
    dimensionCode: 'D03',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'The vendor has successfully handled a past dispute with another client without litigation.',
    rubric: {
      type: 'likert',
      anchor1: 'Unknown or active litigation.',
      anchor5: 'Multiple references confirm amicable resolution.',
    },
  },
  {
    id: 'Q03_2',
    dimensionCode: 'D03',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'The vendor has clear boundaries on scope creep (written SOW, change-order process).',
    rubric: {
      type: 'likert',
      anchor1: 'Scope unclear; frequent disputes.',
      anchor5: 'Strict change-order discipline.',
    },
  },
  {
    id: 'Q03_3',
    dimensionCode: 'D03',
    tierGates: PR_EN,
    type: 'free_form',
    prompt:
      'Describe how the vendor handled the last major disagreement with you or a reference client.',
    rubric: { type: 'free_form', analystScored: true },
    evidenceHint: 'Analyst evaluates narrative quality on a 1-5 scale.',
  },
];

// ────────────────────────────────────────────────────────────────
// D04 — Consistency & Reliability (3)
// ────────────────────────────────────────────────────────────────

const D04: Question[] = [
  {
    id: 'Q04_1',
    dimensionCode: 'D04',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'Vendor has more than 3 clients with more than 24-month retention.',
    rubric: {
      type: 'likert',
      anchor1: 'No long-term clients disclosed.',
      anchor5: '5+ clients with 3+ year relationships.',
    },
  },
  {
    id: 'Q04_2',
    dimensionCode: 'D04',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'Vendor consistently meets published SLAs (uptime ≥ 99.5%, quality error rate < 1%).',
    rubric: {
      type: 'likert',
      anchor1: 'Frequent SLA breaches.',
      anchor5: 'Public uptime page showing 99.9%+.',
    },
  },
  {
    id: 'Q04_3',
    dimensionCode: 'D04',
    tierGates: PR_EN,
    type: 'document_upload',
    prompt: 'Upload the last 12 months of uptime / reliability reports.',
    rubric: {
      type: 'document_upload',
      criteria: ['authenticity', 'completeness', 'currency', 'relevance'],
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D05 — Integrity & Ethics (3)
// ────────────────────────────────────────────────────────────────

const D05: Question[] = [
  {
    id: 'Q05_1',
    dimensionCode: 'D05',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'Vendor has a published code of ethics or conduct applicable to AI and data handling.',
    rubric: {
      type: 'likert',
      anchor1: 'No published code.',
      anchor5: 'Public code, board-approved, annual training certified.',
    },
  },
  {
    id: 'Q05_2',
    dimensionCode: 'D05',
    tierGates: ST_PR_EN,
    type: 'multi_select',
    prompt:
      'Which of these ethics-adjacent incidents has the vendor experienced in the past 3 years?',
    rubric: {
      type: 'multi_select',
      aggregation: 'count_hits',
      options: [
        { value: 'none', label: 'None known', weight: 5 },
        {
          value: 'whistleblower_resolved',
          label: 'Employee whistleblower case (resolved)',
          weight: -1,
        },
        { value: 'regulatory_inquiry', label: 'Regulatory inquiry (not yet closed)', weight: -2 },
        { value: 'discrimination_lawsuit', label: 'Lawsuit alleging discrimination', weight: -2 },
        { value: 'data_misuse', label: 'Publicized data misuse', weight: -3 },
        { value: 'other', label: 'Other (describe)', weight: -1 },
      ],
    },
  },
  {
    id: 'Q05_3',
    dimensionCode: 'D05',
    tierGates: PR_EN,
    type: 'likert',
    prompt: 'Vendor has an independent AI ethics review or external audit.',
    rubric: {
      type: 'likert',
      anchor1: 'None.',
      anchor5: 'Published external audit within the last 12 months.',
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D06 — Financial Behavior (4)
// ────────────────────────────────────────────────────────────────

const D06: Question[] = [
  {
    id: 'Q06_1',
    dimensionCode: 'D06',
    tierGates: ST_PR_EN,
    type: 'single_select',
    prompt: 'Vendor funding status:',
    rubric: {
      type: 'single_select',
      options: [
        { value: 'bootstrapped_profitable', label: 'Bootstrapped and profitable', weight: 5 },
        { value: 'abc_funded', label: 'Series A/B/C funded', weight: 4 },
        { value: 'seed', label: 'Pre-seed or seed only', weight: 3 },
        { value: 'grant_dependent', label: 'Grant or subsidy dependent', weight: 2 },
        { value: 'undisclosed', label: 'Unknown / undisclosed', weight: 1 },
      ],
    },
  },
  {
    id: 'Q06_2',
    dimensionCode: 'D06',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'Vendor has disclosed 12+ months of runway or audited financials.',
    rubric: {
      type: 'likert',
      anchor1: 'Refuses to disclose.',
      anchor5: 'Public or under NDA, 24+ months runway.',
    },
  },
  {
    id: 'Q06_3',
    dimensionCode: 'D06',
    tierGates: PR_EN,
    type: 'document_upload',
    prompt: 'Upload last audited financial statements OR current cap table (under NDA).',
    rubric: {
      type: 'document_upload',
      criteria: ['authenticity', 'completeness', 'currency'],
    },
    evidenceHint: 'Analyst verifies vs commercial register data.',
  },
  {
    id: 'Q06_4',
    dimensionCode: 'D06',
    tierGates: PR_EN,
    type: 'free_form',
    prompt: 'Any pending or recent litigation, bankruptcy, or tax dispute?',
    rubric: { type: 'free_form', analystScored: true },
    evidenceHint: 'Cross-checked with automated litigation_scan test.',
  },
];

// ────────────────────────────────────────────────────────────────
// D07 — Formal Agreements (4)
// ────────────────────────────────────────────────────────────────

const D07: Question[] = [
  {
    id: 'Q07_1',
    dimensionCode: 'D07',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'Vendor standard contract includes clear IP ownership clauses for custom work and AI-generated outputs.',
    rubric: {
      type: 'likert',
      anchor1: 'Ambiguous or missing.',
      anchor5: 'Detailed, reviewed by external counsel.',
    },
  },
  {
    id: 'Q07_2',
    dimensionCode: 'D07',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'A DPA (Data Processing Agreement) is available and GDPR Art. 28 compliant.',
    rubric: {
      type: 'likert',
      anchor1: 'No DPA.',
      anchor5: 'Template available with ability to negotiate.',
    },
  },
  {
    id: 'Q07_3',
    dimensionCode: 'D07',
    tierGates: PR_EN,
    type: 'document_upload',
    prompt: 'Upload the standard DPA and master agreement.',
    rubric: {
      type: 'document_upload',
      criteria: ['authenticity', 'completeness', 'relevance'],
    },
    evidenceHint: 'Analyst runs gdpr_art28_checklist.',
  },
  {
    id: 'Q07_4',
    dimensionCode: 'D07',
    tierGates: PR_EN,
    type: 'multi_select',
    prompt: 'Contract includes which of these?',
    rubric: {
      type: 'multi_select',
      aggregation: 'count_hits',
      options: [
        { value: 'right_to_audit', label: 'Right to audit', weight: 1 },
        { value: 'subprocessor_approval', label: 'Sub-processor approval rights', weight: 1 },
        {
          value: 'data_return_deletion',
          label: 'Data return / deletion on termination',
          weight: 1,
        },
        { value: 'liability_cap', label: 'Liability cap appropriate to risk', weight: 1 },
        { value: 'cyber_insurance', label: 'Cyber insurance requirement', weight: 1 },
        {
          value: 'ip_indemnity',
          label: 'Indemnity for IP infringement (including training data)',
          weight: 1,
        },
      ],
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D08 — Operational Delivery (4)
// ────────────────────────────────────────────────────────────────

const D08: Question[] = [
  {
    id: 'Q08_1',
    dimensionCode: 'D08',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'Vendor has a published BCP/DR plan with tested recovery objectives.',
    rubric: {
      type: 'likert',
      anchor1: 'No plan or untested.',
      anchor5: 'Annual test, results published.',
    },
  },
  {
    id: 'Q08_2',
    dimensionCode: 'D08',
    tierGates: ST_PR_EN,
    type: 'multi_select',
    prompt: 'Which security certifications does the vendor currently hold?',
    rubric: {
      type: 'multi_select',
      aggregation: 'count_hits',
      options: [
        { value: 'iso_27001', label: 'ISO 27001', weight: 1 },
        { value: 'iso_42001', label: 'ISO 42001 (AI management)', weight: 1 },
        { value: 'soc2_type2', label: 'SOC 2 Type II', weight: 1 },
        { value: 'pci_dss', label: 'PCI-DSS', weight: 1 },
        { value: 'hipaa_hitrust', label: 'HIPAA / HITRUST', weight: 1 },
        { value: 'bsi_c5', label: 'BSI C5 (Germany)', weight: 1 },
        { value: 'none', label: 'None current', weight: -3 },
      ],
    },
  },
  {
    id: 'Q08_3',
    dimensionCode: 'D08',
    tierGates: PR_EN,
    type: 'document_upload',
    prompt: 'Upload the last penetration test summary (redacted if needed).',
    rubric: {
      type: 'document_upload',
      criteria: ['authenticity', 'completeness', 'currency', 'relevance'],
    },
  },
  {
    id: 'Q08_4',
    dimensionCode: 'D08',
    tierGates: PR_EN,
    type: 'likert',
    prompt:
      'Mean Time To Detect (MTTD) and Mean Time To Respond (MTTR) for security incidents are tracked and disclosed.',
    rubric: {
      type: 'likert',
      anchor1: 'Not tracked.',
      anchor5: 'MTTD < 1h, MTTR < 24h, disclosed publicly or under NDA.',
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D09 — Governance & Decision Rights (4)
// ────────────────────────────────────────────────────────────────

const D09: Question[] = [
  {
    id: 'Q09_1',
    dimensionCode: 'D09',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'Ultimate Beneficial Owner (UBO) is disclosed and consistent with public registry data.',
    rubric: {
      type: 'likert',
      anchor1: 'Opaque or unverifiable.',
      anchor5: 'UBO matches registry, no PEP or sanctions hit.',
    },
  },
  {
    id: 'Q09_2',
    dimensionCode: 'D09',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'Vendor has independent board oversight or external advisors.',
    rubric: {
      type: 'likert',
      anchor1: 'Solo founder, no board.',
      anchor5: 'Board with independent directors and an audit committee.',
    },
  },
  {
    id: 'Q09_3',
    dimensionCode: 'D09',
    tierGates: PR_EN,
    type: 'free_form',
    prompt:
      'Key-person risk: who are the 1-3 individuals whose departure would materially affect the vendor?',
    rubric: { type: 'free_form', analystScored: true },
  },
  {
    id: 'Q09_4',
    dimensionCode: 'D09',
    tierGates: PR_EN,
    type: 'likert',
    prompt:
      'Decision rights for changes affecting clients (pricing, terms, architecture) are documented.',
    rubric: {
      type: 'likert',
      anchor1: 'Ad-hoc.',
      anchor5: 'Formal change control, client notified.',
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D10 — Exit & Continuity (4)
// ────────────────────────────────────────────────────────────────

const D10: Question[] = [
  {
    id: 'Q10_1',
    dimensionCode: 'D10',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'Data portability: vendor provides export in standard formats within 30 days of termination.',
    rubric: {
      type: 'likert',
      anchor1: 'Lock-in or costly export.',
      anchor5: 'Standard format, self-service export.',
    },
  },
  {
    id: 'Q10_2',
    dimensionCode: 'D10',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'Source-code or model-weight escrow is available (if applicable).',
    rubric: {
      type: 'likert',
      anchor1: 'Not available.',
      anchor5: 'Third-party escrow active.',
    },
  },
  {
    id: 'Q10_3',
    dimensionCode: 'D10',
    tierGates: PR_EN,
    type: 'multi_select',
    prompt: 'Offboarding process includes:',
    rubric: {
      type: 'multi_select',
      aggregation: 'count_hits',
      options: [
        { value: 'termination_playbook', label: 'Written termination playbook', weight: 1 },
        {
          value: 'subprocessor_unwind',
          label: 'Client notification of sub-processor unwind',
          weight: 1,
        },
        { value: 'destruction_certificate', label: 'Data destruction certificate', weight: 1 },
        { value: 'migration_assistance', label: 'Assistance with migration', weight: 1 },
        { value: 'tsa_available', label: 'Transition services agreement available', weight: 1 },
      ],
    },
  },
  {
    id: 'Q10_4',
    dimensionCode: 'D10',
    tierGates: PR_EN,
    type: 'likert',
    prompt: 'Vendor has a succession/continuity plan if key personnel leave.',
    rubric: {
      type: 'likert',
      anchor1: 'None.',
      anchor5: 'Documented, exercised in the past 12 months.',
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D11 — Data Provenance (AI-specific) ⭐ (6)
// ────────────────────────────────────────────────────────────────

const D11: Question[] = [
  {
    id: 'Q11_1',
    dimensionCode: 'D11',
    tierGates: FS_ST_PR_EN,
    type: 'likert',
    prompt: 'Vendor can fully document training data sources for their AI models.',
    rubric: {
      type: 'likert',
      anchor1: 'No lineage.',
      anchor5: 'Complete lineage with licenses and consent basis.',
    },
  },
  {
    id: 'Q11_2',
    dimensionCode: 'D11',
    tierGates: FS_ST_PR_EN,
    type: 'multi_select',
    prompt: 'Training data sources include:',
    rubric: {
      type: 'multi_select',
      aggregation: 'count_hits',
      options: [
        { value: 'public_web', label: 'Public web scrapes' },
        { value: 'licensed_commercial', label: 'Licensed commercial datasets' },
        { value: 'client_data_dpa', label: 'Client-provided data (with DPA)' },
        { value: 'synthetic', label: 'Synthetic data' },
        { value: 'ugc_consent', label: 'User-generated content (with consent)' },
        { value: 'distilled', label: 'Third-party model outputs (distilled)' },
      ],
    },
  },
  {
    id: 'Q11_3',
    dimensionCode: 'D11',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'For any personal data in training, legal basis is documented (GDPR Art. 6).',
    rubric: {
      type: 'likert',
      anchor1: 'Unclear or none.',
      anchor5: 'Art. 6(1)(a) consent OR 6(1)(f) legitimate interest with a documented LIA.',
    },
  },
  {
    id: 'Q11_4',
    dimensionCode: 'D11',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'Data retention policy specifies retention periods per data category.',
    rubric: {
      type: 'likert',
      anchor1: 'Indefinite or unclear.',
      anchor5: 'Specific periods with auto-deletion.',
    },
  },
  {
    id: 'Q11_5',
    dimensionCode: 'D11',
    tierGates: PR_EN,
    type: 'document_upload',
    prompt: 'Upload training data inventory or model card with data section.',
    rubric: {
      type: 'document_upload',
      criteria: ['authenticity', 'completeness', 'currency', 'relevance'],
    },
  },
  {
    id: 'Q11_6',
    dimensionCode: 'D11',
    tierGates: PR_EN,
    type: 'likert',
    prompt:
      'Vendor supports data subject rights (access, deletion, portability) for data in models.',
    rubric: {
      type: 'likert',
      anchor1: 'Cannot delete from a trained model.',
      anchor5: 'Formal process, < 30 days response time.',
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D12 — Model Transparency (AI-specific) ⭐ (6)
// ────────────────────────────────────────────────────────────────

const D12: Question[] = [
  {
    id: 'Q12_1',
    dimensionCode: 'D12',
    tierGates: FS_ST_PR_EN,
    type: 'likert',
    prompt: 'Vendor publishes a Model Card or System Card for each model in production.',
    rubric: {
      type: 'likert',
      anchor1: 'None.',
      anchor5: 'Comprehensive, updated per release.',
    },
  },
  {
    id: 'Q12_2',
    dimensionCode: 'D12',
    tierGates: FS_ST_PR_EN,
    type: 'likert',
    prompt: 'Model versions are tracked and clients are notified of material changes.',
    rubric: {
      type: 'likert',
      anchor1: 'No versioning.',
      anchor5: 'SemVer + changelog + client notice.',
    },
  },
  {
    id: 'Q12_3',
    dimensionCode: 'D12',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'Vendor can explain individual predictions (feature importance, counterfactuals, saliency).',
    rubric: {
      type: 'likert',
      anchor1: 'Pure black box.',
      anchor5: 'Explanation API or LIME/SHAP available.',
    },
  },
  {
    id: 'Q12_4',
    dimensionCode: 'D12',
    tierGates: ST_PR_EN,
    type: 'multi_select',
    prompt: 'Evaluation metrics published for the model:',
    rubric: {
      type: 'multi_select',
      aggregation: 'count_hits',
      options: [
        { value: 'accuracy_f1_auc', label: 'Accuracy / F1 / AUC' },
        { value: 'calibration', label: 'Calibration' },
        { value: 'fairness', label: 'Fairness metrics (demographic parity, equalized odds)' },
        { value: 'robustness', label: 'Robustness (adversarial, OOD)' },
        { value: 'toxicity', label: 'Toxicity / harmful content rate' },
        { value: 'hallucination', label: 'Hallucination rate (for LLMs)' },
      ],
    },
  },
  {
    id: 'Q12_5',
    dimensionCode: 'D12',
    tierGates: PR_EN,
    type: 'document_upload',
    prompt: 'Upload model card / system card / evaluation report.',
    rubric: {
      type: 'document_upload',
      criteria: ['authenticity', 'completeness', 'currency', 'relevance'],
    },
  },
  {
    id: 'Q12_6',
    dimensionCode: 'D12',
    tierGates: PR_EN,
    type: 'likert',
    prompt: 'Vendor permits independent red-teaming or external audit.',
    rubric: {
      type: 'likert',
      anchor1: 'Refused.',
      anchor5: 'Documented via contract + annual external audit.',
    },
  },
];

// ────────────────────────────────────────────────────────────────
// D13 — Regulatory Compliance (AI-specific) ⭐ (8)
// ────────────────────────────────────────────────────────────────

const D13: Question[] = [
  {
    id: 'Q13_1',
    dimensionCode: 'D13',
    tierGates: FS_ST_PR_EN,
    type: 'multi_select',
    prompt: "Under EU AI Act Annex III, which high-risk categories apply to this vendor's AI?",
    rubric: {
      type: 'multi_select',
      aggregation: 'analyst_review',
      options: [
        { value: 'biometrics', label: 'Biometrics' },
        { value: 'critical_infrastructure', label: 'Critical infrastructure' },
        { value: 'education', label: 'Education / vocational training' },
        { value: 'employment', label: 'Employment / worker management' },
        {
          value: 'essential_services',
          label: 'Access to essential services (credit, insurance, public services)',
        },
        { value: 'law_enforcement', label: 'Law enforcement' },
        { value: 'migration', label: 'Migration / border control' },
        { value: 'justice', label: 'Administration of justice' },
        { value: 'none', label: "None of the above (Annex III doesn't apply)" },
      ],
    },
  },
  {
    id: 'Q13_2',
    dimensionCode: 'D13',
    tierGates: FS_ST_PR_EN,
    type: 'likert',
    prompt:
      'Vendor has completed EU AI Act Annex III self-assessment and is registered (if applicable).',
    rubric: {
      type: 'likert',
      anchor1: 'Not started.',
      anchor5: 'Registered, documentation ready.',
    },
  },
  {
    id: 'Q13_3',
    dimensionCode: 'D13',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt: 'GDPR-compliant DPA signed with all sub-processors listed.',
    rubric: {
      type: 'likert',
      anchor1: 'No DPA or incomplete list.',
      anchor5: 'Full DPA + complete sub-processor list + SCCs for transfers.',
    },
  },
  {
    id: 'Q13_4',
    dimensionCode: 'D13',
    tierGates: ST_PR_EN,
    type: 'likert',
    prompt:
      'Art. 73 EU AI Act incident reporting process in place (15-day notification for serious incidents).',
    rubric: {
      type: 'likert',
      anchor1: 'No process.',
      anchor5: 'Documented, tested, with a playbook.',
    },
  },
  {
    id: 'Q13_5',
    dimensionCode: 'D13',
    tierGates: ST_PR_EN,
    type: 'multi_select',
    prompt: 'Which regimes apply and are addressed?',
    rubric: {
      type: 'multi_select',
      aggregation: 'count_hits',
      options: [
        { value: 'eu_ai_act', label: 'EU AI Act', weight: 1 },
        { value: 'gdpr', label: 'GDPR', weight: 1 },
        { value: 'dora', label: 'DORA (financial services only)', weight: 1 },
        { value: 'nis2', label: 'NIS2', weight: 1 },
        { value: 'sectoral', label: 'Sectoral (MDR, PSD2, eIDAS, etc.)', weight: 1 },
      ],
    },
  },
  {
    id: 'Q13_6',
    dimensionCode: 'D13',
    tierGates: PR_EN,
    type: 'document_upload',
    prompt:
      'Upload: signed DPA, sub-processor list, ISO 27001 / SOC 2 report, AI Act self-assessment, NIS2 self-assessment.',
    rubric: {
      type: 'document_upload',
      criteria: ['authenticity', 'completeness', 'currency', 'relevance', 'exceptions'],
    },
  },
  {
    id: 'Q13_7',
    dimensionCode: 'D13',
    tierGates: PR_EN,
    type: 'likert',
    prompt:
      'International data transfers (outside EEA) are covered by SCCs, BCRs, or adequacy decisions.',
    rubric: {
      type: 'likert',
      anchor1: 'Unclear.',
      anchor5: 'Full TIA + latest SCCs module.',
    },
  },
  {
    id: 'Q13_8',
    dimensionCode: 'D13',
    tierGates: PR_EN,
    type: 'free_form',
    prompt:
      'List any open regulatory inquiries, consent orders, or enforcement actions in the past 5 years.',
    rubric: { type: 'free_form', analystScored: true },
    evidenceHint: 'Cross-checked via adverse media scan (ADV_001).',
  },
];

// ────────────────────────────────────────────────────────────────
// Assembled bank + helpers
// ────────────────────────────────────────────────────────────────

export const QUESTIONS: readonly Question[] = [
  ...D01,
  ...D02,
  ...D03,
  ...D04,
  ...D05,
  ...D06,
  ...D07,
  ...D08,
  ...D09,
  ...D10,
  ...D11,
  ...D12,
  ...D13,
] as const;

/** Quick lookups. */
const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

export function getQuestion(id: string): Question | undefined {
  return BY_ID.get(id);
}

export function requireQuestion(id: string): Question {
  const q = getQuestion(id);
  if (!q) throw new Error(`Unknown question: ${id}`);
  return q;
}

export function getQuestionsByDimension(code: DimensionCode): Question[] {
  return QUESTIONS.filter((q) => q.dimensionCode === code);
}

/** Returns questions visible at the given tier (cumulative: EN sees all, FS sees only FS). */
export function questionsForTier(
  tier: 'free_snapshot' | 'starter' | 'pro' | 'enterprise',
): Question[] {
  const gate: TierGate =
    tier === 'free_snapshot' ? 'FS' : tier === 'starter' ? 'ST' : tier === 'pro' ? 'PR' : 'EN';
  return QUESTIONS.filter((q) => q.tierGates.includes(gate));
}

// ────────────────────────────────────────────────────────────────
// Sanity invariants (fail-fast at import)
// ────────────────────────────────────────────────────────────────

if (QUESTIONS.length !== 55) {
  throw new Error(`Expected 55 questions in bank, got ${QUESTIONS.length}.`);
}
const IDS = new Set<string>();
for (const q of QUESTIONS) {
  if (IDS.has(q.id)) throw new Error(`Duplicate question id: ${q.id}`);
  IDS.add(q.id);
}
