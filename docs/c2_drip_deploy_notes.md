# C2 — Drip Campaign Deploy Notes

Vienna Up CTA drip for `/assessment` and `/pilot` form submissions.

**Scope:** persists every POST /v1/intake to `intake_submissions`, schedules
follow-up emails via BullMQ, ships Tx06/Tx07/Tx08 templates, adds
`/v1/unsubscribe/:token` endpoint with native one-click unsubscribe support.

**Cadence:**
- `free_assessment` → Day 3 (Tx06a) + Day 7 (Tx07a)
- `pilot_application` → Day 1 (Tx06b) + Day 5 (Tx07b) + Day 14 (Tx08b)
- `starter / pro / enterprise` → no drip (paid onboarding is a separate workstream)

---

## HARD-GATE — block deploy until done

1. **Cal.com URL verified live.** Open `https://cal.com/partnerscope/partner-strategy`
   in incognito. Must show a 30-min event with available slots and Elshan
   as host. If broken, drip emails will link to a dead URL. See
   `Newsletter_2026_05_18_Vienna_Up/calcom_setup.md` for setup steps.

2. **Resend domain `partnerscope.eu` verified.** The DKIM record
   `resend._domainkey.partnerscope.eu` is in DNS — confirm the dashboard
   actually shows it as Verified for the same Resend account that owns
   AZTender's API key.

---

## Files changed / added

**New:**
- `migrations/004_intake_submissions.sql`
- `apps/api/src/services/email/templates/tx06a_assessment_day3.{hbs,txt.hbs}`
- `apps/api/src/services/email/templates/tx07a_assessment_day7.{hbs,txt.hbs}`
- `apps/api/src/services/email/templates/tx06b_pilot_day1.{hbs,txt.hbs}`
- `apps/api/src/services/email/templates/tx07b_pilot_day5.{hbs,txt.hbs}`
- `apps/api/src/services/email/templates/tx08b_pilot_day14.{hbs,txt.hbs}`
- `apps/api/src/services/queue/index.ts`
- `apps/api/src/services/queue/drip-worker.ts`
- `apps/api/src/routes/unsubscribe.ts`

**Modified:**
- `apps/api/src/db/schema.ts` — added `intakeTierEnum` + `intakeSubmissions` table
- `apps/api/src/services/email/index.ts` — added Tx06/Tx07/Tx08 types + senders + List-Unsubscribe header support
- `apps/api/src/routes/intake.ts` — persists submission, schedules drip jobs
- `apps/api/src/server.ts` — registers unsubscribeRoutes, starts/stops worker

---

## Deploy order (critical)

```bash
# 1. Migration FIRST — schema must exist before app deploys, or POST /v1/intake
#    will start failing on the INSERT.
ssh prod
cd /srv/partnerscope-platform
git pull
pnpm install --frozen-lockfile
DATABASE_URL=... pnpm --filter @partnerscope/api db:migrate

# 2. Verify migration applied
psql $DATABASE_URL -c "SELECT filename FROM _migrations WHERE filename='004_intake_submissions.sql';"

# 3. Restart API container
docker compose -f docker-compose.prod.yml up -d --build api

# 4. Tail logs — expect "drip worker started"
docker compose -f docker-compose.prod.yml logs -f api | grep -E "(drip|migrate|listening)"
```

---

## Local smoke test (BEFORE prod deploy)

Requires: Docker running with postgres + redis on local ports.

```bash
cd /Users/elshanmusayev/Documents/partnerscope-platform

# Start infra
docker compose up -d postgres redis

# Apply migration locally
DATABASE_URL=postgresql://partnerscope:partnerscope@localhost:5432/partnerscope \
  pnpm --filter @partnerscope/api db:migrate

# Run API (will use dev .env). If RESEND_API_KEY unset, runs in dry-run.
pnpm --filter @partnerscope/api dev

# In another terminal — submit a test
curl -i -X POST http://localhost:4000/v1/intake \
  -H 'Content-Type: application/json' \
  -d '{
    "tier": "free_assessment",
    "email": "elshan.musayev@ekmgc.de",
    "buyerName": "Test User",
    "buyerCompany": "Test Co",
    "vendorDomain": "example.com",
    "notes": "C2 smoke test"
  }'

# Expect 201 with {received: true, submissionId: <uuid>, ...}

# Check row landed in DB
psql ... -c "SELECT id, tier, email, tx06a_scheduled_at, tx07a_scheduled_at FROM intake_submissions ORDER BY submitted_at DESC LIMIT 5;"

# Check jobs landed in BullMQ
redis-cli KEYS 'bull:drip-emails:*'
redis-cli ZRANGE 'bull:drip-emails:delayed' 0 -1 WITHSCORES

# Test unsubscribe (use the unsubscribe_token from DB row)
TOKEN=$(psql ... -t -c "SELECT unsubscribe_token FROM intake_submissions ORDER BY submitted_at DESC LIMIT 1;" | xargs)
curl -i "http://localhost:4000/v1/unsubscribe/$TOKEN"
# Expect 200 with HTML "You've been unsubscribed."

# Verify DB updated
psql ... -c "SELECT email, unsubscribed_at FROM intake_submissions WHERE unsubscribe_token='$TOKEN';"
```

To exercise drip delivery in dev (without waiting 3-14 days), temporarily
edit `apps/api/src/services/queue/index.ts` → `DRIP_DELAYS` to seconds:
```ts
day3: 30_000,  // 30 seconds for testing
```
Then submit a free_assessment intake and watch logs for `drip email sent`
after the delay. **Revert before commit.**

---

## Rollback plan

If something is wrong in prod after deploy:

### Option 1 — Disable drip without code rollback (preferred)

```sql
-- Halt ALL future drip sends without removing scheduled BullMQ jobs.
-- Worker will skip jobs whose submission has drip_disabled_at set.
UPDATE intake_submissions
   SET drip_disabled_at = now(),
       drip_disabled_reason = 'rollback: <describe>'
 WHERE drip_disabled_at IS NULL
   AND submitted_at >= '<deploy-date>';
```

For NEW submissions to not schedule drip, the cleanest path is a feature flag:
add `DRIP_DISABLED=1` to env and gate the `addDripJob` calls in intake.ts.
This needs a code change — see Option 2 if you need that today.

### Option 2 — Code rollback

```bash
# Revert intake.ts changes only (preserves DB rows for postmortem):
git revert <intake.ts-commit-sha>
docker compose -f docker-compose.prod.yml up -d --build api

# Full rollback (revert entire C2 feature):
git revert <c2-merge-commit-sha>
docker compose -f docker-compose.prod.yml up -d --build api
# Migration 004 is forward-only — leave intake_submissions table in place.
# It has no FK from older tables; nothing breaks if it just sits there.
```

### Option 3 — Drain BullMQ queue without restart

```bash
docker compose -f docker-compose.prod.yml exec redis redis-cli
> DEL bull:drip-emails:delayed
> DEL bull:drip-emails:wait
> DEL bull:drip-emails:active
# Caveat: in-flight jobs in the worker process will still complete.
```

---

## Monitoring (first week post-deploy)

Log queries to run daily:

```bash
# How many drip emails actually shipped?
docker compose -f docker-compose.prod.yml logs api --since 24h | \
  grep "drip email sent" | wc -l

# Failures?
docker compose -f docker-compose.prod.yml logs api --since 24h | \
  grep -E "(drip job failed|drip scheduling failed)" | head -20

# Unsubscribe rate
psql ... <<EOF
  SELECT
    tier,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL) AS unsubscribed,
    ROUND(100.0 * COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL) / NULLIF(COUNT(*),0), 2) AS unsub_pct
  FROM intake_submissions
  WHERE submitted_at >= NOW() - INTERVAL '7 days'
    AND tier IN ('free_assessment', 'pilot_application')
  GROUP BY tier;
EOF
```

**Healthy ranges (B2B drip baseline):**
- Unsubscribe rate < 1% → fine
- 1-3% → review template tone
- > 3% → halt drip, rewrite content

---

## Known gaps / followups

- **DMARC still `p=none`.** After 2 weeks of clean alignment, tighten to
  `p=quarantine` then `p=reject`. Reports go to elshan.musayev@ekmgc.de.
- **No admin UI for `drip_disabled_at`.** Manual psql UPDATE only.
  Future: `/admin/leads` page with disable button.
- **No conversion tracking.** When a free_assessment lead becomes a paid run,
  update `intake_submissions.converted_run_id` (and call `cancelDripJobs()`).
  Currently this requires manual SQL.
- **No analytics on email opens/clicks.** Resend dashboard has the data,
  but it's not surfaced in our admin views.
