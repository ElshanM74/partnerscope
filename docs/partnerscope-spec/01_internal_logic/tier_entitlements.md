# Tier Entitlements — Feature Flags

**Audience:** Engineering. Use as source of truth for feature gating.
**Version:** 1.0 (2026-04-20)

---

## Feature matrix

| Feature | Free Snapshot | Starter €99 | Pro €499 | Enterprise €4 900/qtr |
|---|---|---|---|---|
| **Questionnaire** | | | | |
| Questions count | 5 | ~39 | ~78 | ~78 + custom |
| Dimensions covered | 3 (AI/Compliance only) | 10 | 13 | 13 + custom |
| Likert detail | band only | full | full | full |
| **Automated tests** | | | | |
| DNS/email security | ❌ | ✅ | ✅ | ✅ |
| TLS/cert health | ❌ | ✅ | ✅ | ✅ |
| Public breach lookup | ❌ | ✅ | ✅ | ✅ |
| Security headers | ❌ | ✅ | ✅ | ✅ |
| Company registry check | ❌ | ❌ | ✅ | ✅ |
| Sanctions/PEP screening | ❌ | ❌ | ✅ | ✅ (daily) |
| Adverse media scan | ❌ | ❌ | ✅ | ✅ (daily) |
| Data residency trace | ❌ | ❌ | ✅ | ✅ |
| Model hosting trace | ❌ | ❌ | ❌ | ✅ |
| ASN/egress analysis | ❌ | ❌ | ❌ | ✅ |
| Dark web monitoring | ❌ | ❌ | ❌ | ✅ |
| GitHub/HF signal tracking | ❌ | ❌ | ❌ | ✅ |
| **Human layer** | | | | |
| Analyst review | ❌ | ❌ | ✅ | ✅ (dedicated) |
| Document review | ❌ | ❌ | up to 10 docs | unlimited |
| Reference calls | ❌ | ❌ | ❌ | ✅ (2-3 calls) |
| Ex-employee interviews | ❌ | ❌ | ❌ | ✅ (add-on) |
| Virtual site visit | ❌ | ❌ | ❌ | ✅ |
| Executive briefing | ❌ | ❌ | ❌ | ✅ |
| **AI Red-Teaming** | | | | |
| Prompt injection tests | ❌ | ❌ | 5 payloads | 25 payloads |
| Jailbreak tests | ❌ | ❌ | ❌ | 15 payloads |
| PII leakage tests | ❌ | ❌ | ❌ | 10 payloads |
| Hallucination rate | ❌ | ❌ | sample 10 | full 50 |
| Bias/fairness audit | ❌ | ❌ | ❌ | ✅ (4 metrics) |
| Adversarial robustness | ❌ | ❌ | ❌ | ✅ |
| **Deliverables** | | | | |
| Preliminary risk band | ✅ | ✅ | ✅ | ✅ |
| PDF report | ❌ | instant | 48h SLA | on-demand |
| Report pages | — | 8-10 | 20-25 | 30-40 |
| EU AI Act Annex III mapping | ❌ | ❌ | ✅ | ✅ |
| GDPR Art. 28 DPA check | ❌ | ❌ | ✅ | ✅ |
| Remediation checklist | ❌ | basic | full 3-bucket | full + tracking |
| Board-ready roll-up | ❌ | ❌ | ❌ | ✅ (quarterly) |
| AI BOM | ❌ | ❌ | ❌ | ✅ |
| **Monitoring** | | | | |
| Continuous monitoring | ❌ | ❌ | ❌ | ✅ |
| Dashboard | ❌ | ❌ | ❌ | ✅ |
| Drift alerts | ❌ | ❌ | ❌ | ✅ (11 signals) |
| Quarterly reassessment | ❌ | ❌ | ❌ | ✅ |
| **Integrations** | | | | |
| API access | ❌ | ❌ | read-only | read+write |
| GRC export (ServiceNow, Archer, OneTrust) | ❌ | ❌ | ❌ | ✅ |
| Slack/Teams alerts | ❌ | ❌ | ❌ | ✅ |
| SAML SSO | ❌ | ❌ | ❌ | ✅ |
| **SLA** | | | | |
| Delivery | instant | instant | 48h | priority (24h ad-hoc) |
| Support channel | — | email | email | dedicated Slack/email |
| Response time | — | 5 biz days | 2 biz days | 4 business hours |

---

## Programmatic feature flags

```json
{
  "free_snapshot": {
    "max_questions": 5,
    "dimensions": [11, 12, 13],
    "deliverable": "risk_band_only",
    "next_step_cta": "starter_or_signup"
  },
  "starter": {
    "max_questions": 39,
    "dimensions": [1,2,3,4,5,6,7,8,9,10,11,12,13],
    "min_dimensions_scored": 10,
    "automated_tests": ["dns_security","tls_health","breach_lookup","security_headers"],
    "deliverable": "instant_pdf",
    "analyst_review": false,
    "sla_hours": 0,
    "price_eur": 99,
    "payment_model": "one_off"
  },
  "pro": {
    "max_questions": 78,
    "dimensions": [1,2,3,4,5,6,7,8,9,10,11,12,13],
    "automated_tests": ["dns_security","tls_health","breach_lookup","security_headers","company_registry","sanctions_pep","adverse_media","data_residency"],
    "document_review_limit": 10,
    "redteam_suite": "lite_5_prompt_injection",
    "deliverable": "analyst_reviewed_pdf",
    "analyst_review": true,
    "sla_hours": 48,
    "annex3_mapping": true,
    "gdpr_dpa_check": true,
    "price_eur": 499,
    "payment_model": "one_off",
    "intro_discount_eur": 299
  },
  "enterprise": {
    "max_questions": 78,
    "custom_dimensions_allowed": true,
    "min_vendors": 15,
    "dimensions": "all_plus_custom",
    "automated_tests": "all_12",
    "document_review_limit": null,
    "redteam_suite": "full",
    "bias_fairness_audit": true,
    "adversarial_testing": true,
    "reference_calls": 3,
    "site_visit": "virtual",
    "continuous_monitoring": true,
    "drift_alerts": 11,
    "quarterly_reassessment": true,
    "dashboard": true,
    "grc_integrations": ["servicenow","archer","onetrust"],
    "sso": "saml",
    "dedicated_analyst": true,
    "sla_priority_hours": 24,
    "support_channel": "dedicated_slack",
    "price_eur_per_quarter": 4900,
    "payment_model": "quarterly_retainer",
    "annual_discount_pct": 15
  }
}
```

---

## Upgrade paths (auto-suggest in product)

- Starter → Pro: if user requests PDF re-issue, or uploads docs, or asks for Annex III mapping
- Pro → Enterprise: if user submits 3+ Pro reports in rolling 90 days, OR requests "monitoring", OR company >1000 employees
- Free → Starter: after Touch 2 email (T+7 days)

---

## Stripe product mapping

See `06_api_schemas/stripe_products.md` for SKUs, price IDs, and webhook event handlers.
