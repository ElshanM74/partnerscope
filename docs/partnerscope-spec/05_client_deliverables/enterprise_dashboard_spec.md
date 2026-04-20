# Enterprise Dashboard Specification (€4 900/quarter)

Version: 1.0 · Last updated: 2026-04-20

Enterprise clients get a continuous dashboard + deeper deliverables. Pricing: €4 900/quarter retainer. Minimum 15 vendors. Dedicated analyst + SLA 24h on new assessments.

---

## Access

- URL: `dashboard.partnerscope.eu`
- SSO via SAML 2.0 / OIDC (Okta, Azure AD, Google Workspace)
- Role-based access: Viewer / Analyst / Admin
- IP allow-listing available
- Audit log of every page view + export

---

## Home view

- Portfolio-level summary
  - Total vendors monitored
  - Distribution by band (HIGH / MED / LOW / MIN) — donut
  - Last 30-day delta: new red flags, score changes > 10 pts
  - Open remediation items
- Top 10 risky vendors table (sortable)
- Recent continuous-monitoring alerts (last 14 days)

## Vendor detail view

Identical sections to Pro report, but:
- Live-refreshed scores (weekly signal polling)
- Timeline of score over last 12 months
- Evidence repository (signed URLs, object-lock verified)
- All 25 automated tests results
- Full 25 red-team payloads (with vendor authorisation)
- Human-intelligence findings (reference calls, ex-employee interviews, site visit logs)
- 4th-party supply-chain map (graph view)

## Continuous monitoring panel

11 signals (per `automated_tests_spec.md` CNT_001):
1. New breach
2. Sanctions hit
3. Adverse media
4. TLS cert change
5. Security header regression
6. Whois change
7. Model version bump
8. New SBOM CVE ≥ 7.0
9. Credit score delta ≥ 10
10. UBO change
11. DNS / MX change

Each signal → dashboard banner + email digest + optional webhook to client's SIEM / GRC tool.

## Integrations

| Tool | Direction | Protocol |
|------|-----------|----------|
| ServiceNow GRC | Push findings | REST webhook |
| Archer | Push findings | REST webhook |
| OneTrust | Push DPA registry | REST |
| Splunk / Sentinel | Stream alerts | HTTP Event Collector |
| Slack / Teams | Alerts | Incoming webhook |
| Jira | Create remediation tickets | REST |
| SAP Ariba | Vendor sync | SOAP/REST |
| Coupa | Vendor sync | REST |

## Reports

- Monthly portfolio PDF (auto-generated, 15-25 pp)
- Quarterly executive briefing (30 min call + slide deck)
- Ad-hoc deep-dive PDF on any vendor (24h SLA)
- Annual AI Act / DORA / NIS2 compliance posture summary

## Human-intelligence module (Enterprise only)

- Up to 2 reference calls per vendor per quarter
- Up to 1 ex-employee interview per vendor per year (via licensed research partner)
- On-request site visit (cost-plus; travel passed through)
- All outputs: recorded (with consent), transcribed, redacted, filed

## Data export

- CSV, JSON, Parquet
- API access (see `06_api_schemas/openapi.yaml`)
- Scheduled exports (daily / weekly) to S3 / GCS / Azure Blob

## SLAs

| Item | Target |
|------|--------|
| New assessment | 24h |
| Ad-hoc deep-dive | 24h |
| Continuous monitoring polling | 7d |
| Critical alert (e.g. sanctions hit) | 2h to email + dashboard |
| Support response P1 | 1h |
| Quarterly business review | month 3, 6, 9, 12 |

## Minimum scope

- 15 vendors minimum (additional at €199/vendor/quarter)
- Quarterly retainer billed in advance
- 12-month initial term, rolling quarterly renewal
