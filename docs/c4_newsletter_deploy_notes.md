# C4 — Newsletter Cross-Post Deploy Notes

«Before the Pitch» email cross-post via Resend Audiences + Broadcasts.

**Resend Audience ID:** `16be44bf-fc35-4bce-8e8f-78467cc55b0d` (in partnerscope account)

## Files added/modified

**partnerscope-platform:**
- `apps/api/src/routes/newsletter.ts` — POST /v1/newsletter/subscribe
- `apps/api/src/server.ts` — registers newsletterRoutes
- `apps/api/src/config/env.ts` — adds RESEND_NEWSLETTER_AUDIENCE_ID
- `apps/web/src/pages/newsletter.astro` — partnerscope.eu/newsletter

**/Documents/Scripts/email-automation/newsletter_publish/:**
- `publish_newsletter.py` — CLI markdown → Resend Broadcasts
- `templates/issue_wrapper.{html,txt}` — issue email layout
- `.env` — local override with audience ID (NOT committed — gitignored)
- `README.md` — usage docs

## HARD-GATE before deploy

1. **Add to prod env:** `RESEND_NEWSLETTER_AUDIENCE_ID=16be44bf-fc35-4bce-8e8f-78467cc55b0d` in `partnerscope-platform/.env` on Hetzner.
2. **Confirm RESEND_API_KEY in prod env** can talk to Resend Audiences API (the `partnerscope-prod-send` key with Sending Access permission should work — Audiences are also covered by Sending scope per Resend's permission model).

## Deploy order

```bash
ssh prod
cd /srv/partnerscope-platform
git pull
pnpm install --frozen-lockfile

# Add to .env (one new line):
echo "RESEND_NEWSLETTER_AUDIENCE_ID=16be44bf-fc35-4bce-8e8f-78467cc55b0d" >> .env

# Restart api + web
docker compose -f docker-compose.prod.yml up -d --build api web

# Tail logs
docker compose -f docker-compose.prod.yml logs -f api | grep -E "(newsletter|listening)"
```

## Post-deploy smoke test

```bash
# 1. Subscribe via API
curl -X POST https://api.partnerscope.eu/v1/newsletter/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"elshan.musayev@ekmgc.de","firstName":"Elshan","locale":"en"}'

# Expect 201 with {subscribed: true, contactId: "xxx"}

# 2. Subscribe via page
# Open https://partnerscope.eu/newsletter in incognito → fill form → submit
# Expect inline success state

# 3. Verify in Resend dashboard
# https://resend.com/audience?segmentId=16be44bf-fc35-4bce-8e8f-78467cc55b0d
# Should show 1 contact (elshan.musayev@ekmgc.de)

# 4. Idempotency check — second subscribe with same email
curl -X POST https://api.partnerscope.eu/v1/newsletter/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"elshan.musayev@ekmgc.de","firstName":"Elshan"}'

# Expect 200 with {subscribed: true, already: true}
```

## First newsletter publish

```bash
# On local Mac (not prod)
cd /Users/elshanmusayev/Documents/Scripts/email-automation
source .venv/bin/activate

# Dry-run preview (always do this first)
python newsletter_publish/publish_newsletter.py \
  --markdown /Users/elshanmusayev/Documents/Newsletter_2026_05_10/article_EN.md \
  --issue 1 \
  --title "The \$1M Asymmetry" \
  --subtitle "How jurisdiction choice determines whether your startup reaches PMF" \
  --dry-run

# Review output. If looks good — real publish:
python newsletter_publish/publish_newsletter.py \
  --markdown /Users/elshanmusayev/Documents/Newsletter_2026_05_10/article_EN.md \
  --issue 1 \
  --title "The \$1M Asymmetry" \
  --subtitle "How jurisdiction choice determines whether your startup reaches PMF" \
  --confirm

# CLI creates Broadcast but does NOT auto-send. URL printed at end:
#   https://resend.com/broadcasts/<broadcast-id>

# Open it → review recipient count + preview → click Send when ready
```

## Rollback

If subscribe endpoint is misbehaving:

**Option 1 — Disable via env** (no code change):
```bash
# In prod .env, comment out:
# RESEND_NEWSLETTER_AUDIENCE_ID=...
docker compose -f docker-compose.prod.yml up -d --build api
# Endpoint will return 202 dryRun=true without hitting Resend (graceful no-op)
```

**Option 2 — Revert code:**
```bash
git revert <commit-sha>
docker compose -f docker-compose.prod.yml up -d --build api web
```

The Audience in Resend persists across deploys — no data loss on revert.

## Known gaps / future work

- **Welcome email on subscribe** — not yet wired. Currently subscriber gets first issue at next publish. Could add a Tx10-style welcome with link to LinkedIn archive in v2.
- **Confirmed opt-in (DOI)** — Resend Audiences doesn't natively support double opt-in flow. Subscribers are added directly. For stricter GDPR posture, build a confirm-link flow in v2.
- **EN/RU split** — current Audience treats all subscribers as one list. If you start an RU newsletter parallel to EN, create a separate Audience and add `locale` filtering in subscribe API.
- **Analytics in admin** — open/click rates visible in Resend dashboard only. No surface in partnerscope-platform admin yet.
