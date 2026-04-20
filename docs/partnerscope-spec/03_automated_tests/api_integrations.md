# External API Integrations

Version: 1.0 · Last updated: 2026-04-20

All third-party services the automated test runner depends on. Env-var names match those used in Claude Code integration.

## Summary table

| Provider | Purpose | Env var | Pricing model | Used in tier |
|----------|---------|---------|---------------|--------------|
| HIBP (Have I Been Pwned) | Breach + dark-web | `HIBP_API_KEY` | $3.95/mo hobbyist, $1095/yr Enterprise | ST+ |
| SSL Labs API | TLS scanning (free) | — | Free, 1 req/s | ST+ |
| Mozilla Observatory | Header + TLS grade | — | Free | ST+ |
| OpenSanctions | Sanctions + PEP | `OS_API_KEY` | €500-2000/mo | ST+ |
| CreditSafe | Credit + insolvency DACH | `CREDITSAFE_API_KEY`, `CREDITSAFE_SECRET` | €4-12/lookup | PR+ |
| Bisnode (Dun & Bradstreet) | Credit + firmographics | `DNB_API_KEY` | Contract-based | PR+ (alt) |
| OpenCorporates | Global registry | `OC_API_KEY` | $50-600/mo | PR+ |
| Transparenzregister (DE) | UBO (Germany) | session cookie + captcha solver | €4.50/entity | PR+ |
| WiEReG (AT) | UBO (Austria) | `WIEREG_CLIENT_ID`, `WIEREG_CERT` | €3/lookup | PR+ |
| Zefix (CH) | Registry + UBO (CH) | — | Free API | PR+ |
| Intel X | Dark-web / leak search | `INTELX_API_KEY` | €2500/yr Pro | EN |
| CT Logs (crt.sh) | Cert transparency | — | Free | ST+ |
| MaxMind GeoIP2 | ASN + country of IP | `MAXMIND_LICENSE` | $0-100/mo | EN |
| BaFin Register | License check DE | — | Free web scrape (ToS-checked) | PR+ |
| FMA Register | License check AT | — | Free JSON endpoint | PR+ |
| FINMA Register | License check CH | — | Free CSV | PR+ |
| HuggingFace Hub | Model Card fetch | `HF_TOKEN` | Free | PR+ |
| OpenAI | AI Act classifier + doc NLP | `OPENAI_API_KEY` | $0.01-0.06/report | PR+ |
| Anthropic | Red-team orchestration | `ANTHROPIC_API_KEY` | $0.03-0.15/report | PR+ |
| Stripe | Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | 1.4% + €0.25 | all tiers |
| Postmark | Transactional email | `POSTMARK_SERVER_TOKEN` | $15/mo 10k msgs | all |
| AWS S3 | Evidence storage (object-lock) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_EVIDENCE_BUCKET` | ~$0.023/GB | all |
| Sentry | Error tracking | `SENTRY_DSN` | $26/mo team | all |

---

## Endpoint details

### HIBP v3
```
GET https://haveibeenpwned.com/api/v3/breacheddomain/{domain}
Headers:
  hibp-api-key: ${HIBP_API_KEY}
  user-agent: PartnerScope/1.0
Rate limit: 10 req / 10 sec
```

### OpenSanctions
```
POST https://api.opensanctions.org/match/default
Headers:
  Authorization: ApiKey ${OS_API_KEY}
Body:
{
  "queries": {
    "q1": {
      "schema": "Company",
      "properties": { "name": ["ACME GmbH"], "jurisdiction": ["de"] }
    }
  }
}
```

### CreditSafe OAuth2
```
# Step 1 — authenticate
POST https://connect.creditsafe.com/v1/authenticate
Body: { "username": "...", "password": "..." }
→ { "token": "..." }

# Step 2 — search
GET https://connect.creditsafe.com/v1/companies?countries=DE&name={q}
Authorization: ${token}

# Step 3 — report
GET https://connect.creditsafe.com/v1/companies/{id}
```

### OpenCorporates
```
GET https://api.opencorporates.com/v0.4/companies/search
Params: q={name}, jurisdiction_code=de, api_token=${OC_API_KEY}
```

### Zefix (CH)
```
POST https://www.zefix.admin.ch/ZefixPublicREST/api/v1/company/search
Body: { "name": "{q}" }
```

### BaFin (DE financial license)
```
# No public API — scrape with compliance
GET https://portal.mvp.bafin.de/database/InstInfo/sucheForm.do
Post form with entity name; parse HTML response.
Rate limit: 1 req / 3s to respect ToS.
```

### Model Card from HuggingFace
```
GET https://huggingface.co/api/models/{org}/{model}
Authorization: Bearer ${HF_TOKEN}
Returns: tags, cardData, downloads, license
```

### OpenAI (AI Act classifier prompt)
```python
from openai import OpenAI
client = OpenAI()

resp = client.chat.completions.create(
    model="gpt-4.1-mini",
    response_format={"type": "json_object"},
    messages=[
        {"role": "system", "content": open("prompts/aia_classifier.md").read()},
        {"role": "user", "content": json.dumps(vendor_declaration)}
    ]
)
```

### Intel X (Enterprise dark-web)
```
POST https://2.intelx.io/intelligent/search
Headers:
  x-key: ${INTELX_API_KEY}
Body:
{
  "term": "{domain}",
  "maxresults": 100,
  "media": 0,
  "sort": 4
}
```

---

## Resilience patterns

| Pattern | Implementation |
|---------|----------------|
| Circuit breaker | `pybreaker`, fail threshold 5, reset 60s |
| Caching | Redis, TTL 24h for registry data, 1h for adverse media |
| Rate limiting | Token bucket per provider |
| Fallback chain | CreditSafe → Bisnode → OpenCorporates (graceful degradation) |
| Secrets | AWS Secrets Manager; never log raw keys |

## Observability

- Every external call emits span `external.{provider}.{operation}`
- Metrics: `pps.api.{provider}.latency_ms`, `.error_rate`, `.cost_eur`
- Daily Slack digest: cost burn vs monthly cap per provider

## Cost guardrails

```python
MONTHLY_CAPS_EUR = {
  "creditsafe": 800,
  "opensanctions": 600,
  "opencorporates": 150,
  "intelx": 250,
  "openai": 300,
  "anthropic": 300,
}
```

If cap exceeded → switch provider to fallback + PagerDuty alert.

## Legal / ToS notes

- **HIBP:** Enterprise tier required for domain-wide breach scans (Hobbyist forbids B2B use)
- **BaFin/FMA/FINMA:** Web scraping allowed if < 1 req/3s, no personal data, attribution on report
- **Transparenzregister DE:** Programmatic access currently requires captcha — evaluate `register.transparenzregister.de` paid API alternative before launch
- **OpenSanctions:** CC-BY-NC for hobby tier; **commercial tier mandatory** for PartnerScope B2B use
