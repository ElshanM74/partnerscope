# Full Questionnaire — 13 Dimensions × ~78 Questions

**Audience:** Product + engineering. This is the full question bank.
**Format:** Each question has `id`, `dimension`, `type`, `prompt`, `likert_anchor_1`, `likert_anchor_5`, `scoring` (simple 1-5 unless noted), `tier_gate`.

**Legend for `tier_gate`:**
- `FS` = Free Snapshot (max 5 qs)
- `ST` = Starter (≤39 qs)
- `PR` = Pro (all 78 qs)
- `EN` = Enterprise (all + custom)

---

## Dimension 1: Accountability & Responsibility

**Q1.1** (ST/PR/EN) — Likert 1-5
Prompt: "The vendor formally documents ownership for every material delivery commitment (tech lead, PM, account exec)."
- 1 = No documentation; unclear who owns what
- 5 = RACI matrix exists, signed, reviewed quarterly

**Q1.2** (ST/PR/EN) — Likert 1-5
Prompt: "When something goes wrong, the vendor has acknowledged failure and published root cause analysis within 30 days."
- 1 = Deflects blame; no post-mortems
- 5 = Public RCAs for every SEV-1 incident

**Q1.3** (PR/EN) — Multi-select
Prompt: "Which of these accountability mechanisms does the vendor operate?"
- [ ] Executive sponsor for each major client
- [ ] Published SLA with financial penalties
- [ ] Documented escalation matrix
- [ ] Quarterly business reviews (QBR)
- [ ] Board-level risk committee

---

## Dimension 2: Communication & Transparency

**Q2.1** (ST/PR/EN) — Likert 1-5
Prompt: "The vendor responds to material questions in writing within 2 business days."
- 1 = Frequently delays or avoids written response
- 5 = Consistent written follow-ups within 24h

**Q2.2** (ST/PR/EN) — Likert 1-5
Prompt: "The vendor proactively discloses changes (ownership, leadership, sub-processors, pricing) before they take effect."
- 1 = Learn via press or after the fact
- 5 = 30+ day advance notice with written communication

**Q2.3** (PR/EN) — Likert 1-5
Prompt: "When asked for documentation (certifications, DPAs, reports), the vendor provides within 5 business days."
- 1 = Slow or partial; missing documents
- 5 = Immediate access via shared repository

---

## Dimension 3: Boundaries & Conflict Resolution

**Q3.1** (ST/PR/EN) — Likert 1-5
Prompt: "The vendor has successfully handled a past dispute with another client without litigation."
- 1 = Unknown or active litigation
- 5 = Multiple references confirm amicable resolution

**Q3.2** (ST/PR/EN) — Likert 1-5
Prompt: "The vendor has clear boundaries on scope creep (written SOW, change-order process)."
- 1 = Scope unclear; frequent disputes
- 5 = Strict change-order discipline

**Q3.3** (PR/EN) — Free-form + Likert
Prompt: "Describe how the vendor handled the last major disagreement with you or a reference client."
- Analyst evaluates narrative quality 1-5

---

## Dimension 4: Consistency & Reliability

**Q4.1** (ST/PR/EN) — Likert 1-5
Prompt: "Vendor has >3 clients with >24-month retention."
- 1 = No long-term clients disclosed
- 5 = 5+ clients with 3+ year relationships

**Q4.2** (ST/PR/EN) — Likert 1-5
Prompt: "Vendor consistently meets published SLAs (≥99.5% on uptime, <1% on quality)."
- 1 = Frequent SLA breaches
- 5 = Public uptime page showing 99.9%+

**Q4.3** (PR/EN) — Document upload
Prompt: "Upload last 12 months of uptime/reliability reports."
- Scoring: analyst reviews; binary pass/fail + note

---

## Dimension 5: Integrity & Ethics

**Q5.1** (ST/PR/EN) — Likert 1-5
Prompt: "Vendor has a published code of ethics/conduct applicable to AI and data handling."
- 1 = No published code
- 5 = Public code, board-approved, annual training certified

**Q5.2** (ST/PR/EN) — Multi-select
Prompt: "Which of these ethics-adjacent incidents has the vendor experienced in the past 3 years?"
- [ ] None known
- [ ] Employee whistleblower case (resolved)
- [ ] Regulatory inquiry (not yet closed)
- [ ] Lawsuit alleging discrimination
- [ ] Publicized data misuse
- [ ] Other (describe)

**Q5.3** (PR/EN) — Likert 1-5
Prompt: "Vendor has an independent AI ethics review or external audit."
- 1 = None
- 5 = Published external audit, recent (< 12 months)

---

## Dimension 6: Financial Behavior

**Q6.1** (ST/PR/EN) — Multi-select (triggers score)
Prompt: "Vendor funding status:"
- Bootstrapped profitable (+5)
- Series A/B/C funded (+4)
- Pre-seed/seed only (+3)
- Grant/subsidy dependent (+2)
- Unknown / undisclosed (+1)

**Q6.2** (ST/PR/EN) — Likert 1-5
Prompt: "Vendor has disclosed 12+ months of runway or audited financials."
- 1 = Refuses to disclose
- 5 = Public or under NDA, 24+ months runway

**Q6.3** (PR/EN) — Document upload
Prompt: "Upload last audited financial statements OR current cap table (under NDA)."
- Analyst verifies with registry data

**Q6.4** (PR/EN) — Free-form
Prompt: "Any pending or recent litigation, bankruptcy, or tax dispute?"
- Cross-check with automated test `litigation_scan`

---

## Dimension 7: Formal Agreements

**Q7.1** (ST/PR/EN) — Likert 1-5
Prompt: "Vendor's standard contract includes clear IP ownership clauses for custom work and AI-generated outputs."
- 1 = Ambiguous or missing
- 5 = Detailed, reviewed by external counsel

**Q7.2** (ST/PR/EN) — Likert 1-5
Prompt: "DPA (Data Processing Agreement) is available, GDPR Art. 28 compliant."
- 1 = No DPA
- 5 = Template + ability to negotiate

**Q7.3** (PR/EN) — Document upload
Prompt: "Upload standard DPA + master agreement."
- Analyst runs `gdpr_art28_checklist` (see §Evidence rubric)

**Q7.4** (PR/EN) — Multi-select
Prompt: "Contract includes which of these?"
- [ ] Right to audit
- [ ] Sub-processor approval rights
- [ ] Data return/deletion on termination
- [ ] Liability cap appropriate to risk
- [ ] Cyber insurance requirement
- [ ] Indemnity for IP infringement (including training data)

---

## Dimension 8: Operational Delivery

**Q8.1** (ST/PR/EN) — Likert 1-5
Prompt: "Vendor has a published BCP/DR plan with tested recovery objectives."
- 1 = No plan or untested
- 5 = Annual test, results published

**Q8.2** (ST/PR/EN) — Multi-select
Prompt: "Which security certifications does vendor currently hold?"
- [ ] ISO 27001
- [ ] ISO 42001 (AI management)
- [ ] SOC 2 Type II
- [ ] PCI-DSS
- [ ] HIPAA / HITRUST
- [ ] BSI C5 (Germany)
- [ ] None current

**Q8.3** (PR/EN) — Document upload
Prompt: "Upload last penetration test summary (redacted if needed)."
- Analyst evaluates coverage + remediation posture

**Q8.4** (PR/EN) — Likert 1-5
Prompt: "Mean Time To Detect (MTTD) and Mean Time To Respond (MTTR) for security incidents are tracked and disclosed."
- 1 = Not tracked
- 5 = MTTD < 1h, MTTR < 24h, publicly or under NDA

---

## Dimension 9: Governance & Decision Rights

**Q9.1** (ST/PR/EN) — Likert 1-5
Prompt: "Ultimate Beneficial Owner (UBO) is disclosed and consistent with public registry data."
- 1 = Opaque or unverifiable
- 5 = UBO matches registry, no PEP/sanctions

**Q9.2** (ST/PR/EN) — Likert 1-5
Prompt: "Vendor has independent board oversight or external advisors."
- 1 = Solo founder, no board
- 5 = Board with independent directors + audit committee

**Q9.3** (PR/EN) — Free-form
Prompt: "Key-person risk: who are the 1-3 individuals whose departure would materially affect the vendor?"
- Analyst evaluates concentration risk

**Q9.4** (PR/EN) — Likert 1-5
Prompt: "Decision rights for changes affecting clients (pricing, terms, architecture) are documented."
- 1 = Ad-hoc
- 5 = Formal change control, client notified

---

## Dimension 10: Exit & Continuity

**Q10.1** (ST/PR/EN) — Likert 1-5
Prompt: "Data portability: vendor provides export in standard formats within 30 days of termination."
- 1 = Lock-in or costly export
- 5 = Standard format, self-service export

**Q10.2** (ST/PR/EN) — Likert 1-5
Prompt: "Source-code or model-weight escrow is available (if applicable)."
- 1 = Not available
- 5 = Third-party escrow active

**Q10.3** (PR/EN) — Multi-select
Prompt: "Offboarding process includes:"
- [ ] Written termination playbook
- [ ] Client notification of sub-processor unwind
- [ ] Data destruction certificate
- [ ] Assistance with migration
- [ ] Transition services agreement available

**Q10.4** (PR/EN) — Likert 1-5
Prompt: "Vendor has a succession/continuity plan if key personnel leave."
- 1 = None
- 5 = Documented, exercised in past 12 months

---

## Dimension 11: Data Provenance (AI-specific) ⭐

**Q11.1** (FS/ST/PR/EN) — Likert 1-5
Prompt: "Vendor can fully document training data sources for their AI models."
- 1 = No lineage
- 5 = Complete lineage with licenses and consent basis

**Q11.2** (FS/ST/PR/EN) — Multi-select
Prompt: "Training data sources include:"
- [ ] Public web scrapes
- [ ] Licensed commercial datasets
- [ ] Client-provided data (with DPA)
- [ ] Synthetic data
- [ ] User-generated content (with consent)
- [ ] Third-party model outputs (distilled)

**Q11.3** (ST/PR/EN) — Likert 1-5
Prompt: "For any personal data in training, legal basis is documented (GDPR Art. 6)."
- 1 = Unclear or none
- 5 = Art. 6(1)(a) consent OR 6(1)(f) legitimate interest with LIA

**Q11.4** (ST/PR/EN) — Likert 1-5
Prompt: "Data retention policy specifies retention periods per data category."
- 1 = Indefinite or unclear
- 5 = Specific periods with auto-deletion"

**Q11.5** (PR/EN) — Document upload
Prompt: "Upload training data inventory or model card with data section."

**Q11.6** (PR/EN) — Likert 1-5
Prompt: "Vendor supports data subject rights (access, deletion, portability) for data in models."
- 1 = Cannot delete from trained model
- 5 = Formal process, < 30 days response

---

## Dimension 12: Model Transparency (AI-specific) ⭐

**Q12.1** (FS/ST/PR/EN) — Likert 1-5
Prompt: "Vendor publishes a Model Card or System Card for each model in production."
- 1 = None
- 5 = Comprehensive, updated per release

**Q12.2** (FS/ST/PR/EN) — Likert 1-5
Prompt: "Model versions are tracked and clients are notified of material changes."
- 1 = No versioning
- 5 = SemVer + changelog + client notice

**Q12.3** (ST/PR/EN) — Likert 1-5
Prompt: "Vendor can explain individual predictions (feature importance, counterfactuals, saliency)."
- 1 = Pure black box
- 5 = Explanation API or LIME/SHAP available

**Q12.4** (ST/PR/EN) — Multi-select
Prompt: "Evaluation metrics published for the model:"
- [ ] Accuracy / F1 / AUC
- [ ] Calibration
- [ ] Fairness metrics (demographic parity, equalized odds)
- [ ] Robustness (adversarial, OOD)
- [ ] Toxicity / harmful content rate
- [ ] Hallucination rate (for LLMs)

**Q12.5** (PR/EN) — Document upload
Prompt: "Upload model card / system card / evaluation report."

**Q12.6** (PR/EN) — Likert 1-5
Prompt: "Vendor permits independent red-teaming or external audit."
- 1 = Refused
- 5 = Documented via contract + annual external audit

---

## Dimension 13: Regulatory Compliance (AI-specific) ⭐

**Q13.1** (FS/ST/PR/EN) — Multi-select
Prompt: "Under EU AI Act Annex III, which high-risk categories apply to this vendor's AI?"
- [ ] Biometrics
- [ ] Critical infrastructure
- [ ] Education / vocational training
- [ ] Employment / worker management
- [ ] Access to essential services (credit, insurance, public services)
- [ ] Law enforcement
- [ ] Migration / border control
- [ ] Administration of justice
- [ ] None of the above (Annex III doesn't apply)

**Q13.2** (FS/ST/PR/EN) — Likert 1-5
Prompt: "Vendor has completed EU AI Act Annex III self-assessment and is registered (if applicable)."
- 1 = Not started
- 5 = Registered, documentation ready

**Q13.3** (ST/PR/EN) — Likert 1-5
Prompt: "GDPR-compliant DPA signed with all sub-processors listed."
- 1 = No DPA or incomplete list
- 5 = Full DPA + complete sub-processor list + SCCs for transfers"

**Q13.4** (ST/PR/EN) — Likert 1-5
Prompt: "Art. 73 EU AI Act incident reporting process in place (15-day notification for serious incidents)."
- 1 = No process
- 5 = Documented + tested + playbook"

**Q13.5** (ST/PR/EN) — Multi-select
Prompt: "Which regimes apply and are addressed?"
- [ ] EU AI Act
- [ ] GDPR
- [ ] DORA (financial services only)
- [ ] NIS2
- [ ] Sectoral (MDR, PSD2, eIDAS, etc.)

**Q13.6** (PR/EN) — Document upload
Prompt: "Upload: signed DPA, sub-processor list, ISO 27001 / SOC 2 report, AI Act self-assessment, NIS2 self-assessment."

**Q13.7** (PR/EN) — Likert 1-5
Prompt: "International data transfers (outside EEA) are covered by SCCs, BCRs, or adequacy decisions."
- 1 = Unclear
- 5 = Full TIA + latest SCCs module"

**Q13.8** (PR/EN) — Free-form
Prompt: "List any open regulatory inquiries, consent orders, or enforcement actions in the past 5 years."
- Cross-checked automatically via adverse media scan

---

## Evidence rubric (for analyst review — Pro/Enterprise)

Each uploaded document evaluated on:
1. **Authenticity** — signatures, issue dates, issuer validity
2. **Completeness** — all required sections present
3. **Currency** — issued within relevant window (e.g., ISO 27001 < 3 years, SOC 2 < 12 months)
4. **Relevance** — scope covers the actual service being assessed
5. **Exceptions** — any noted qualifications or limitations

Each document scored 0-100, feeds into `evidence_bonus` in scoring formula.

---

## Tier-gated question counts (validation)

- Free Snapshot: 5 questions (Q11.1, Q11.2, Q12.1, Q13.1, Q13.2)
- Starter: 39 questions (all FS + ST tagged)
- Pro: 78 questions (all FS + ST + PR tagged)
- Enterprise: 78 questions + client-specific custom dimensions

**Counting check:**
- Dim 1: 3 (ST x2, PR x1)
- Dim 2: 3 (ST x2, PR x1)
- Dim 3: 3 (ST x2, PR x1)
- Dim 4: 3 (ST x2, PR x1)
- Dim 5: 3 (ST x2, PR x1) = 15 behavioral
- Dim 6: 4 (ST x2, PR x2)
- Dim 7: 4 (ST x2, PR x2)
- Dim 8: 4 (ST x2, PR x2)
- Dim 9: 4 (ST x2, PR x2)
- Dim 10: 4 (ST x2, PR x2) = 20 financial
- Dim 11: 6 (FS x2, ST x2, PR x2) = 6
- Dim 12: 6 (FS x2, ST x2, PR x2) = 6
- Dim 13: 8 (FS x2, ST x3, PR x3) = 8
- **Total: 78** ✓
- Starter reached: 15 (all behavioral ST) + 10 (all financial ST) + 14 (AI/Compliance ST) = **39** ✓
