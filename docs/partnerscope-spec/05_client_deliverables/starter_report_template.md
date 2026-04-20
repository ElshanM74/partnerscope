# Starter Report Template (€99)

Document type: PDF, 5-8 pages, A4, PartnerScope brand  
Generator: Python + WeasyPrint from HTML/CSS template  
SLA: 24h from payment confirmation

---

## Cover page

```
PARTNERSCOPE SNAPSHOT
————————————————————
{{VENDOR_LEGAL_NAME}}
{{VENDOR_DOMAIN}}

Report ID: PS-{{YEAR}}-STA-{{SEQUENCE}}
Issued: {{ISSUE_DATE}}
Valid until: {{ISSUE_DATE + 90 days}}
Requested by: {{BUYER_NAME}}, {{BUYER_COMPANY}}

Composite risk score: {{SCORE}}/100
Risk band: {{RISK_BAND}}
```

Visual: radial gauge (HIGH red / MEDIUM amber / LOW green / MINIMAL dark-green).

---

## Page 2 — Executive summary (1 page)

- One-paragraph verdict (3-4 sentences)
- Top 3 strengths (bullets)
- Top 3 concerns (bullets)
- Recommended action: **PROCEED** / **PROCEED WITH CONDITIONS** / **HOLD** / **DECLINE**

Generation rule: composite ≥ 66 → PROCEED; 41-65 → CONDITIONS; ≤ 40 → HOLD or DECLINE (DECLINE only if hard red flag present).

---

## Page 3 — 13-dimension scorecard

Compact table:

| Cluster | Dimension | Score | Band |
|---------|-----------|-------|------|
| Behavioral | D1 Communication | 72 | LOW |
| Behavioral | D2 Contract | 65 | MEDIUM |
| ... | ... | ... | ... |
| AI/Compliance | D13 Regulatory | 54 | MEDIUM |
| **Composite** | — | **{{SCORE}}** | **{{BAND}}** |

---

## Page 4 — Automated test results

Only tests run at Starter tier:
- DNS + DNSSEC
- TLS + cipher
- Security headers
- Breach history (domain)
- Mail deliverability (SPF/DKIM/DMARC)
- Sanctions (basic screening)
- CT log scan

Each row: test name · status (pass/warn/fail) · 1-line finding.

---

## Page 5 — Red flags

Only hard red flags present. If none: "No hard red flags identified."

Example entries:
- **Sanctions hit** (EU Consolidated list, 0.98 similarity) — workflow halted
- **Expired TLS certificate** — impacts customer trust and data integrity

---

## Page 6 — Data gaps

Questions not answered or evidence not provided. Each with suggested upgrade to Pro for full verification.

---

## Page 7 — Upgrade path

Comparison box: Starter (current) vs Pro (€499):
- Pro adds: full 78-question analysis, documentary review, AI red-team (5 payloads), sanctions + adverse media + UBO + credit
- Offer: "Upgrade within 30 days — €299 intro price (save €200)"
- CTA: partnerscope.eu/upgrade?from={{REPORT_ID}}

---

## Page 8 — Methodology & disclaimers

- Source list (automated test providers used)
- Scope (automated + questionnaire only; no documentary / human review)
- Validity period (90 days)
- Disclaimer: "Snapshot; not a substitute for full due diligence. PartnerScope makes no warranty of the vendor's future conduct."
- Contact: reports@partnerscope.eu

---

## Footer on every page

```
PartnerScope · EKM Global Consulting GmbH · partnerscope.eu
Report PS-{{YEAR}}-STA-{{SEQUENCE}} · {{PAGE}}/{{TOTAL}} · Confidential
```

---

## Data bindings (Jinja2 context)

```json
{
  "report_id": "PS-2026-STA-00042",
  "vendor": { "legal_name": "…", "domain": "…", "country": "DE" },
  "buyer": { "name": "…", "company": "…", "email": "…" },
  "issue_date": "2026-04-21",
  "composite": {"score": 72, "band": "LOW"},
  "dimensions": [ { "code": "D1", "name": "Communication", "score": 72, "band": "LOW" }, "…" ],
  "tests": [ { "id": "TLS_001", "status": "pass", "finding": "TLS 1.3, grade A" }, "…" ],
  "red_flags": [],
  "data_gaps": [ { "question_id": "Q23", "text": "…", "upgrade_cta": "Pro verifies this via DPA review" } ]
}
```
