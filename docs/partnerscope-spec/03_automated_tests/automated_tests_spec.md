# Automated Tests Specification

Version: 1.0 · Last updated: 2026-04-20

This document defines every auto-test PartnerScope runs on a vendor domain / entity. Each test maps to one or more of the 13 dimensions and contributes a numeric sub-score.

## Test runner

- Framework: Python 3.12 + Celery workers
- Orchestrator: `partnerscope.core.test_runner.run_all(vendor_id, tier)`
- Timeout per test: 30s (soft), 120s (hard kill)
- Retries: 2 with exponential backoff (1s, 5s)
- Result schema: `TestResult` (see `06_api_schemas/json_schemas/test_result.schema.json`)

```python
TestResult = {
  "test_id": "DNS_TLS_001",
  "dimension_code": "D3",
  "status": "pass" | "warn" | "fail" | "error",
  "score": 0-100,
  "evidence_url": "s3://...",
  "raw_payload": {...},
  "executed_at": ISO8601,
  "runtime_ms": int
}
```

---

## Tier matrix (which tests run at which tier)

| # | Test ID | Name | Dim | FS | ST | PR | EN |
|---|---------|------|-----|----|----|----|----|
| 1 | DNS_001 | DNS records + DNSSEC | D3 | ✓ | ✓ | ✓ | ✓ |
| 2 | TLS_001 | TLS handshake + cipher quality | D3 | ✓ | ✓ | ✓ | ✓ |
| 3 | HDR_001 | Security headers (HSTS, CSP, XFO, XCTO, Referrer) | D3 |   | ✓ | ✓ | ✓ |
| 4 | BRC_001 | HIBP breach check (corporate domains) | D3 |   | ✓ | ✓ | ✓ |
| 5 | MX_001 | Mail deliverability (SPF, DKIM, DMARC) | D3 |   | ✓ | ✓ | ✓ |
| 6 | CT_001 | Certificate Transparency log scan | D3 |   | ✓ | ✓ | ✓ |
| 7 | SAN_001 | Sanctions screening (OFAC, EU, UK, UN) | D5, D7 |   | ✓ | ✓ | ✓ |
| 8 | PEP_001 | PEP (Politically Exposed Persons) screening | D7 |   |   | ✓ | ✓ |
| 9 | ADV_001 | Adverse-media scan (≥ 30 day window) | D5, D7 |   |   | ✓ | ✓ |
| 10 | REG_001 | Commercial register lookup (HR, FN, CH, AZ) | D7 |   |   | ✓ | ✓ |
| 11 | UBO_001 | UBO extraction + match | D7 |   |   | ✓ | ✓ |
| 12 | CRD_001 | Credit score (Bisnode / CreditSafe) | D6 |   |   | ✓ | ✓ |
| 13 | INS_001 | Insolvency register (DE, AT, CH, AZ, EU) | D6 |   |   | ✓ | ✓ |
| 14 | LIC_001 | Regulatory license check (BaFin, FMA, FINMA) | D8 |   |   | ✓ | ✓ |
| 15 | SBM_001 | SBOM parse + CVE correlation | D12 |   |   | ✓ | ✓ |
| 16 | MDC_001 | Model Card completeness | D12 |   |   | ✓ | ✓ |
| 17 | AIA_001 | EU AI Act Annex III classification check | D13 |   |   | ✓ | ✓ |
| 18 | GDR_001 | GDPR Art. 28 DPA clause extractor (NLP) | D2, D13 |   |   | ✓ | ✓ |
| 19 | DRK_001 | Dark-web exposure (Intel X, Have I Been Pwned Enterprise) | D3 |   |   |   | ✓ |
| 20 | ASN_001 | ASN + egress IP geolocation | D9 |   |   |   | ✓ |
| 21 | SUB_001 | Sub-processor enumeration + concentration | D9 |   |   |   | ✓ |
| 22 | DRF_001 | Model drift signal (public benchmarks) | D12 |   |   |   | ✓ |
| 23 | DRA_001 | DORA ICT register cross-check | D13 |   |   |   | ✓ |
| 24 | SUP_001 | Supply-chain depth (4th-party) | D9 |   |   |   | ✓ |
| 25 | CNT_001 | Continuous monitoring (11 signals, weekly) | cross |   |   |   | ✓ |

**Counts:** Free Snapshot 2 · Starter 7 · Pro 18 · Enterprise 25 (+ continuous).

---

## Detailed test specs (critical subset)

### DNS_001 — DNS records + DNSSEC
- Tool: `dnspython` + `resolver.Resolver(ad=True)`
- Checks: A, AAAA, MX, NS, SOA, CAA, DNSSEC validation
- Scoring:
  - DNSSEC valid: 100
  - DNSSEC enabled but failing: 40
  - No DNSSEC: 60
  - Resolution error: 0
- Evidence: JSON of full record set + chain of trust
- Ref: RFC 4033-4035

### TLS_001 — TLS handshake + cipher quality
- Tool: `sslyze` with Mozilla Intermediate profile
- Checks: TLS 1.2+, no SSLv3/TLS 1.0/1.1, cipher suites, cert chain, OCSP stapling, HSTS preload
- Scoring: Mozilla Observatory grade → numeric (A+=100, A=90, B=70, C=50, D=30, F=10)
- Evidence: Full scan JSON
- Fail triggers: Self-signed cert, expired cert, Heartbleed, ROBOT, Logjam

### HDR_001 — Security headers
- Tool: `requests` + header parser
- Required headers and weights:
  - `Strict-Transport-Security` (20)
  - `Content-Security-Policy` (25)
  - `X-Content-Type-Options: nosniff` (10)
  - `X-Frame-Options: DENY/SAMEORIGIN` (10)
  - `Referrer-Policy` (10)
  - `Permissions-Policy` (10)
  - `Cross-Origin-*` (15)
- Score = sum of weights present

### BRC_001 — Breach check
- Tool: HIBP API v3 (`/breachedaccount/{domain}` enterprise endpoint)
- Auth: API key via `HIBP_API_KEY` env
- Scoring:
  - 0 breaches last 24 months: 100
  - 1 breach, < 10k records: 70
  - 1 breach, ≥ 10k records: 40
  - ≥ 2 breaches: 10
  - Breach involving PII + passwords in last 12 months: hard red flag

### SAN_001 — Sanctions screening
- Sources: OFAC SDN, EU consolidated list, UK OFSI, UN Security Council
- Tool: `opensanctions` self-hosted + fuzzy match (Jaro-Winkler ≥ 0.90)
- Inputs: legal entity name + all listed directors + UBOs
- Scoring:
  - No match: 100
  - Name similarity 0.90-0.95 with different country: 50 (warn)
  - High-confidence match: 0 + hard red flag + workflow halt

### UBO_001 — UBO extraction + match
- Sources:
  - DE: Transparenzregister
  - AT: WiEReG
  - CH: SHAB / Zefix
  - AZ: Ministry of Taxes commercial register
  - EU fallback: OpenCorporates paid API
- Extraction: PDF / JSON parsed, beneficial owners ≥ 25% listed
- Cross-check: name matches vendor-provided UBO disclosure
- Mismatch = hard red flag

### MDC_001 — Model Card completeness
- Input: vendor-provided Model Card (PDF or MD)
- Extractor: `transformers` + custom regex for sections
- Required sections (per NIST AI RMF + Google Model Card Toolkit):
  1. Intended use
  2. Out-of-scope use
  3. Training data source
  4. Evaluation metrics
  5. Ethical considerations
  6. Limitations
  7. Version + date
- Score = (sections_present / 7) × 100; < 50 caps composite at 65

### AIA_001 — EU AI Act Annex III classification
- Input: vendor self-declaration + use-case narrative
- LLM classifier (GPT-4 class) trained on Annex III sectors:
  - Biometrics
  - Critical infrastructure
  - Education
  - Employment
  - Essential services
  - Law enforcement
  - Migration/border
  - Admin of justice & democracy
- Output: risk class + confidence + applicable obligations
- If high-risk declared and Art. 16 obligations not met → hard red flag

### CNT_001 — Continuous monitoring signals (Enterprise weekly)
11 signals polled every 7 days:
1. New breach (HIBP)
2. New sanctions hit
3. New adverse media item
4. TLS cert change (CT log)
5. Security header regression
6. Whois / registrant change
7. Model version bump (if API exposed)
8. New SBOM CVE ≥ CVSS 7.0
9. Filed account / credit score delta ≥ 10 pts
10. UBO change
11. DNS / MX record change

Any signal fires → delta alert email + dashboard notification + score recomputation.

---

## Failure semantics

- `error` = transient infrastructure failure — retry next run, do not score
- `fail` = test completed, vendor fails criterion — contributes 0 to 40 depending on severity
- `warn` = completed with soft issue — contributes 50-70
- `pass` = completed successfully — contributes 80-100

## Observability

- Each run emits OpenTelemetry trace → stored in `test_runs` table
- PagerDuty alert if error rate > 5% over 15 min
- SLO: 99% of tests complete < 60s

## Compliance & logging

- All third-party API calls logged with request hash (not payload)
- PII minimization: domain + company name only; no employee PII sent to HIBP beyond domain query
- GDPR Art. 6(1)(f) legitimate interest basis; documented in privacy notice
