# Scoring Engine — Internal Logic

**Audience:** Engineering only. Do NOT expose scoring weights or formulas to clients.
**Version:** 1.0 (2026-04-20)

---

## 1. Overview

Every PartnerScope report produces a **weighted composite score 0–100** across 13 dimensions.
Each dimension has:
- A set of questions (Likert 1–5 + multiple-choice + document upload)
- A dimension-level weight
- A dimension score 0–100 derived from answers + automated tests + evidence review

Composite = weighted sum of dimension scores, mapped to 4 risk bands.

---

## 2. Risk Bands

| Band | Score | Meaning | CTA in report |
|---|---|---|---|
| HIGH | 0–40 | Do not onboard without remediation | Block contract; request specific evidence |
| MEDIUM | 41–65 | Onboard with conditions & monitoring | Conditional approval; list remediation before signing |
| LOW | 66–85 | Standard onboarding, quarterly review | Proceed; add to quarterly review list |
| MINIMAL | 86–100 | Standard contract, annual review | Proceed; reduce review frequency |

**Colors (hex):**
- HIGH: `#ef4444` (red)
- MEDIUM: `#f59e0b` (amber)
- LOW: `#10b981` (green)
- MINIMAL: `#3b82f6` (blue)

---

## 3. Dimension weights

13 dimensions grouped into 3 pillars. Weights sum to 100.

### Pillar A: Behavioral (25%)
| # | Dimension | Weight |
|---|---|---|
| 1 | Accountability & Responsibility | 5 |
| 2 | Communication & Transparency | 5 |
| 3 | Boundaries & Conflict Resolution | 5 |
| 4 | Consistency & Reliability | 5 |
| 5 | Integrity & Ethics | 5 |

### Pillar B: Financial/Structural (30%)
| # | Dimension | Weight |
|---|---|---|
| 6 | Financial Behavior | 6 |
| 7 | Formal Agreements | 6 |
| 8 | Operational Delivery | 6 |
| 9 | Governance & Decision Rights | 6 |
| 10 | Exit & Continuity | 6 |

### Pillar C: AI & Compliance (45%) — core differentiator
| # | Dimension | Weight |
|---|---|---|
| 11 | Data Provenance | 15 |
| 12 | Model Transparency | 15 |
| 13 | Regulatory Compliance | 15 |

**Rationale:** AI & Compliance carries 45% because it's the regulatory crown jewel and the reason enterprise buyers pay €499-€4 900. For consumer legacy tier only, weights are rebalanced (see `tier_entitlements.md`).

---

## 4. Dimension score calculation

For each dimension `D`:

```
D_score = (0.6 × questionnaire_score) + (0.3 × automated_tests_score) + (0.1 × evidence_bonus)
```

Where:
- `questionnaire_score` (0–100) = avg of Likert answers × 20, mapped to 0-100
- `automated_tests_score` (0–100) = pass rate of relevant automated tests (Starter runs 4, Pro 8, Enterprise 12)
- `evidence_bonus` (0–100) = 0 if no docs uploaded; 50 if docs uploaded but unverified; 100 if analyst-verified

**Tier adjustments:**
- **Starter:** no evidence review → `evidence_bonus = 0`; formula simplifies to `0.7 × questionnaire + 0.3 × automated`
- **Pro:** full formula with analyst verification
- **Enterprise:** full formula + AI red-team modifier (see §6)

---

## 5. Composite score

```
composite = Σ (D_i.score × D_i.weight) / 100
```

Rounded to integer 0–100.

**Tier-locked floor:** if any single AI/Compliance dimension (11, 12, 13) scores ≤ 40, composite is **capped at 65** regardless of other scores. This enforces "one HIGH in AI compliance = no MINIMAL band."

---

## 6. AI Red-Team modifier (Enterprise only)

If AI red-team suite runs, apply multiplier to dimensions 11, 12:

| Red-team result | Dim 11 multiplier | Dim 12 multiplier |
|---|---|---|
| 0 critical findings | 1.00 | 1.00 |
| 1-2 critical | 0.85 | 0.85 |
| 3-5 critical | 0.70 | 0.70 |
| 6+ critical | 0.50 | 0.50 |

"Critical" = prompt injection succeeded, PII leaked, jailbreak opened dangerous capability, or bias ratio < 0.8 (disparate impact).

---

## 7. Red flag generation

Auto-generate red flag card if ANY of:
- Dimension score ≤ 40
- Automated test hard-fail (e.g., expired TLS cert, open breach)
- Sanctions/PEP match
- Missing mandatory document (DPA for EU processing, ISO 27001 for financial services)
- Training data lineage undisclosed AND AI Act Annex III applies

Each red flag gets severity tag: `blocker` | `high` | `medium`.

---

## 8. Remediation priority algorithm

Sort remediation items by:
1. Severity (blocker → high → medium)
2. Cost-to-fix (low → high) — inferred from dimension
3. Compliance deadline (AI Act Art. 73 = 15 days; GDPR breach = 72h; etc.)

Output three buckets:
- **Before contract signature** (blockers + high severity + low cost)
- **Within 30 days of onboarding** (remaining high + medium severity)
- **Quarterly monitoring** (everything else)

---

## 9. Versioning

- `scoring_version`: increments when weights or formula change. Current: `1.0.0`
- `framework_version`: increments when dimensions added/removed. Current: `13.0`
- Both stored with every report for audit reproducibility.

---

## 10. Edge cases

- **Skipped questions:** max 10% per dimension; more → dimension marked "INSUFFICIENT_DATA" and excluded from composite (weight redistributed proportionally).
- **Vendor refuses automated scan:** `automated_tests_score = 0` for that dimension, note added to report.
- **Document upload fails virus scan:** reject, notify client, do not block report.
- **Composite = exactly 40, 65, or 85:** use lower band (conservative).
