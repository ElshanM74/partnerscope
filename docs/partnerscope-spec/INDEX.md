# PartnerScope — Final Integration Package

**Version:** 2026-04-20 (3-tier consolidation)
**Owner:** Elshan Musayev — EKM Global Consulting
**Domain:** partnerscope.eu
**Purpose:** Complete blueprint for Claude Code integration. Contains all internal logic, client-facing deliverables, API contracts, DB schemas, AI payloads, and copy.

---

## How to use this package in Claude Code

Paste this entire folder into your repo as `docs/partnerscope-spec/` and reference from issues/PRs. Each file is self-contained and Claude Code can implement it directly.

**Implementation order (recommended):**
1. `06_api_schemas/db_schema.sql` — database tables
2. `06_api_schemas/openapi.yaml` — API contracts
3. `02_dimensions/13_dimensions.json` — questionnaire content
4. `01_internal_logic/scoring_engine.md` — scoring algorithm
5. `03_automated_tests/` — external integrations
6. `04_ai_redteam/` — AI red-team module (Pro/Enterprise)
7. `05_client_deliverables/` — PDF report templates
8. `07_email_copy/` — drip sequences
9. `08_pricing_page/` — /plans page copy

---

## Package contents

### 01_internal_logic/ — Как система думает (не показывать клиенту)
- `scoring_engine.md` — формула 0–100, веса измерений, risk bands
- `tier_entitlements.md` — что разрешено на каждом тарифе (feature flags)
- `workflow_state_machine.md` — lifecycle отчёта от submit до delivered

### 02_dimensions/ — 13 измерений риска
- `13_dimensions.json` — полная структура (machine-readable)
- `questions_full.md` — все вопросы с привязкой к регуляторике
- `evidence_requirements.md` — какие документы требовать для Pro/Enterprise

### 03_automated_tests/ — Автоматические проверки
- `automated_tests_spec.md` — 12 тестов, схема, частота, APIs
- `api_integrations.md` — ключи, лимиты, стоимость внешних API
- `test_payloads.json` — конкретные HTTP запросы

### 04_ai_redteam/ — AI Red-Teaming (Pro/Enterprise)
- `redteam_suite.md` — методология
- `prompt_injection_payloads.json` — 25 готовых payloads
- `jailbreak_payloads.json` — 15 jailbreak prompts
- `pii_leakage_tests.json` — 10 PII extraction attempts
- `bias_fairness_methodology.md` — Enterprise only

### 05_client_deliverables/ — Что получает клиент
- `starter_report_template.md` — Instant PDF (€99)
- `pro_report_template.md` — Analyst-reviewed PDF (€499)
- `enterprise_dashboard_spec.md` — Dashboard + quarterly PDF (€4 900/qtr)
- `remediation_checklist_template.md` — готовый чеклист
- `sample_redteam_report.md` — пример AI Red-Team mini-report

### 06_api_schemas/ — Техническая спецификация
- `db_schema.sql` — PostgreSQL schema
- `openapi.yaml` — REST API contract
- `json_schemas/` — JSON schemas для request/response
- `stripe_products.md` — Stripe SKU + webhook events

### 07_email_copy/ — Email sequences
- `drip_sequence_buyer_side.md` — T+1/T+3/T+7/T+14/T+21
- `drip_sequence_vendor_side.md` — для AI vendors
- `transactional_emails.md` — report ready, invoice, reminders

### 08_pricing_page/ — /plans страница
- `pricing_page_copy.md` — hero, tiers, FAQ
- `cta_ladder.md` — Warm → Qualifying → Close
- `comparison_table.md` — machine-readable таблица сравнения

---

## Key business rules (critical — do not deviate)

1. **Single domain:** `partnerscope.eu/plans` is canonical. `b2b.partnerscope.eu` and `/pricing` → 301 redirect to `/plans`.
2. **Three tiers only:** €99 Starter / €499 Pro / €4 900/qtr Enterprise. No bespoke, no intermediate tiers.
3. **Free lead-magnet:** 60-second snapshot (5 questions, no account) — feeds drip sequence.
4. **Target geo:** DACH primary (DE/AT/CH) + Azerbaijan secondary.
5. **Decision-makers:** CISO, Chief Compliance Officer, Head of Vendor Risk, Head of Procurement, Head of AI Governance (in that order).
6. **13 dimensions framework:** 5 behavioral + 5 financial/structural + 3 AI/compliance. Never reduce below 10 for any tier.
7. **Pro SLA:** 48 hours analyst delivery.
8. **Enterprise:** min 15 vendors, quarterly retainer, dedicated analyst.
9. **Legacy tiers removed:** €4.99 / €19.90 consumer and €990 / €1 990 / €2 500 / €15 000 B2B — deprecated.
10. **Language:** EN primary, DE secondary, RU tertiary (consumer legacy only).

---

## Regulatory anchors (cite in every report)

- **EU AI Act:** Regulation (EU) 2024/1689 — Annex III (high-risk), Art. 10 (data governance), Art. 15 (accuracy/robustness/cybersecurity), Annex IV (tech docs), Art. 73 (incident reporting)
- **GDPR:** Regulation (EU) 2016/679 — Art. 28 (processors), Art. 32 (security), Art. 44-49 (transfers)
- **DORA:** Regulation (EU) 2022/2554 — Art. 28-30 (ICT third-party risk)
- **NIS2:** Directive (EU) 2022/2555 — supply chain security
- **NIST AI RMF 1.0** (reference framework, not mandatory)

---

## Contact for questions during implementation

Elshan Musayev — elshan.musayev@ekmgc.de
