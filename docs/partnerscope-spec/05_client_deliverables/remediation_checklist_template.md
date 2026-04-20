# Remediation Checklist Template

Attached to every Pro + Enterprise report. Vendor-facing. 1 page PDF + editable Word.

---

## Header

```
REMEDIATION PLAN — {{VENDOR_LEGAL_NAME}}
Generated from PartnerScope report {{REPORT_ID}} on {{ISSUE_DATE}}
Target re-score date: {{ISSUE_DATE + 90d}}
Contact: {{ANALYST_EMAIL}}
```

---

## Structure

For each concern in the report, one row:

| # | Concern | Dimension | Severity | Action required | Owner | Deadline | Evidence needed |
|---|---------|-----------|----------|-----------------|-------|----------|-----------------|
| 1 | No DPA in place | D2 | Critical | Sign GDPR Art. 28 DPA; attach SCCs if non-EU transfer | Legal | 14d | Signed PDF |
| 2 | Missing Model Card sections | D12 | High | Add `out_of_scope_use` and `ethical_considerations` to Model Card; publish on HF Hub | ML Ops | 30d | Public URL |
| 3 | No DR drill in last 12 months | D10 | Medium | Conduct tabletop DR exercise; publish post-mortem | Head of IT | 60d | Drill report PDF |
| ... | ... | ... | ... | ... | ... | ... | ... |

---

## Severity legend

- **Critical** — hard red flag; resolution mandatory before next re-score
- **High** — caps composite at 65; resolve within 30d
- **Medium** — -10 to -25 on dimension; resolve within 60d
- **Low** — -5 on dimension; resolve within 90d

## Re-scoring

Upon completion, vendor submits evidence package → PartnerScope verifies → new report issued:
- Pro: 72h re-score, included once per report
- Enterprise: 24h re-score, unlimited during retainer

## Footer

```
This plan is advisory. Completing it improves the PartnerScope score but does not
constitute certification or legal compliance. Vendor remains responsible for
regulatory adherence.
PartnerScope · EKM Global Consulting GmbH · partnerscope.eu
```
