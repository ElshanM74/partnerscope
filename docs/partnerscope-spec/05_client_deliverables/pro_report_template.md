# Pro Report Template (€499)

Document type: PDF, 20-30 pages, A4, full brand  
Generator: Python + WeasyPrint, charts via Plotly → PNG  
SLA: 48h from payment + questionnaire completion  
Reference: `Demo_Scorecard_DataFlow_GmbH.pdf` (PS-2026-DEMO-001) in `/Users/elshanmusayev/Documents/PartnerScope_Sales/`

---

## Structure (13 sections)

### 1. Cover & meta (1 page)
As Starter, plus:
- Analyst name + signature
- QA reviewer name
- Revision history (v1.0, v1.1 if reissued)

### 2. Executive summary (2 pages)
- Verdict paragraph
- Top 5 strengths + top 5 concerns
- Risk timeline chart (score trajectory if reissued)
- RACI matrix of recommended remediation owners

### 3. Scorecard (2 pages)
- Full 13-dimension radar chart
- Sub-scores per question cluster within each dimension
- Benchmark: vs industry median (DACH SaaS / AI vendors) from anonymized PartnerScope corpus

### 4. Cluster: Behavioral (3 pages, D1-D5)
Per dimension:
- Score + band
- Key findings (3-5 bullets)
- Evidence cited (with artefact ID and storage ref)
- Recommendation

### 5. Cluster: Financial/Structural (3 pages, D6-D10)
Same structure. Includes:
- Credit report excerpt
- UBO chart (boxes + arrows)
- Sanctions + adverse-media summary table
- License attestations

### 6. Cluster: AI/Compliance (4 pages, D11-D13)
Per dimension, plus:
- Data-provenance matrix
- Model Card checklist (7 sections, marked ✓/✗)
- EU AI Act Annex III classification + obligations gap list
- GDPR Art. 28 DPA clause compliance

### 7. AI Red-Team results (2 pages)
5 payloads run:
- Payload category, severity, outcome (Blocked / Partial / Succeeded)
- Redacted reproduction (if critical)
- Overall red-team composite score

### 8. Automated test appendix (3 pages)
All 18 Pro-tier tests, one row each:
- Test ID · Dim · Status · Score · 2-line finding · Evidence URL

### 9. Documentary review (2 pages)
Checklist of submitted documents:
- DPA, MSA, ISO 27001, SOC 2, Model Card, SBOM, IR plan, BCP, Sub-processor list
- Per doc: present? authentic? current? compliant?

### 10. Risk register (1 page)
Top 10 risks ranked by likelihood × impact. Format:
| # | Risk | Likelihood | Impact | Score | Mitigation |

### 11. Remediation roadmap (1 page)
30 / 60 / 90-day plan to move from current score to next band.

### 12. Valid-until & revalidation (0.5 page)
- Valid 180 days
- Quarterly refresh add-on: €199
- Triggered re-score on material event (see continuous monitoring)

### 13. Methodology & disclaimers (1 page)
- Full source list with versions/dates
- Scope limits
- Dispute process (vendor right of reply; 15-day window)
- Analyst independence statement
- Contact: pro-reports@partnerscope.eu

---

## Visual elements

- Radar chart (dim scorecard) — Plotly polar
- UBO diagram — Graphviz DOT
- Timeline chart (continuous monitoring) — Plotly line
- Heatmap (risk likelihood × impact) — Plotly
- Test status bars — Plotly bar

All charts rendered as PNG at 300 DPI, embedded in PDF.

---

## Language

- English primary; German translation available at +€149
- Russian / Azerbaijani translations on request (Enterprise pricing)

---

## Jinja2 context (extends Starter context)

```json
{
  "tier": "pro",
  "analyst": { "name": "…", "qualifications": "…" },
  "qa_reviewer": { "name": "…" },
  "clusters": {
    "behavioral": {"score": 71, "findings": [...]},
    "financial": {"score": 78, "findings": [...], "ubo_diagram_png": "…"},
    "ai_compliance": {"score": 62, "findings": [...]}
  },
  "red_team": {
    "payloads_run": 5,
    "blocked": 4,
    "partial": 1,
    "succeeded": 0,
    "composite": 88,
    "findings": [...]
  },
  "documents_reviewed": [
    {"name": "DPA", "status": "present_compliant", "notes": "Art. 28 compliant; SCCs attached"}
  ],
  "risk_register": [...],
  "remediation_plan": {
    "30d": [...],
    "60d": [...],
    "90d": [...]
  }
}
```

---

## Compliance copy (footer)

```
Report PS-{{YEAR}}-PRO-{{SEQ}} · Pro tier · SLA 48h
© 2026 EKM Global Consulting GmbH · partnerscope.eu · All rights reserved.
Distribution: {{BUYER_COMPANY}} internal use only. Sharing beyond buyer
organization requires written consent.
Aligned with EU AI Act, GDPR, DORA, NIS2 frameworks. Not a legal opinion.
```
