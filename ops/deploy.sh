#!/usr/bin/env bash
# PartnerScope deploy script — runs ON THE SERVER, called by GitHub Actions or manually.
#
# Usage (on server, as `deploy`):
#   cd /opt/partnerscope
#   ./deploy.sh
#
# Invariants:
#   - /opt/partnerscope/.env      exists and is chmod 600
#   - /opt/partnerscope/docker-compose.prod.yml is the current compose file
#   - /opt/partnerscope/nginx.conf is the current nginx config (symlinked from sites-enabled)
#   - /var/www/partnerscope/web   is the Astro dist/ output
#
# Exits non-zero on any failure; safe to re-run.

set -euo pipefail

PROJECT_DIR="/opt/partnerscope"
NGINX_CONF_SRC="${PROJECT_DIR}/nginx.conf"
NGINX_CONF_DST="/etc/nginx/sites-available/partnerscope.conf"
NGINX_CONF_LINK="/etc/nginx/sites-enabled/partnerscope.conf"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f "${PROJECT_DIR}/.env" ]] || fail ".env missing at ${PROJECT_DIR}/.env"
[[ -f "${PROJECT_DIR}/docker-compose.prod.yml" ]] || fail "docker-compose.prod.yml missing"
[[ "$(stat -c '%a' "${PROJECT_DIR}/.env")" == "600" ]] || fail ".env must be chmod 600"

cd "${PROJECT_DIR}"

# ─── 1. Sync nginx config if it changed ───────────────────────────────────
# nginx config is hand-tuned on this server (signup/register unblock,
# manual server_name, certbot bindings) and ops/nginx.conf in repo is
# stale. Skip by default; opt-in with SKIP_NGINX=0 once repo + prod
# are reconciled and deploy user has NOPASSWD sudo for cp + ln.
if [[ "${SKIP_NGINX:-1}" != "1" && -f "${NGINX_CONF_SRC}" ]]; then
    sudo cp "${NGINX_CONF_SRC}" "${NGINX_CONF_DST}"
    sudo ln -sf "${NGINX_CONF_DST}" "${NGINX_CONF_LINK}"
    sudo nginx -t || fail "nginx config test failed — not reloading"
    sudo systemctl reload nginx
    log "nginx reloaded"
else
    log "nginx sync skipped (SKIP_NGINX=${SKIP_NGINX:-1})"
fi

# ─── 1.5 Ensure required non-secret env vars (idempotent) ────────────────
# Audience ID is a public-ish UUID — it identifies the «Before the Pitch»
# Resend Audience but is useless without the (secret) RESEND_API_KEY. Safe
# to bake here for one-time injection; future deploys are no-ops due to
# the grep guard.
NEWSLETTER_AUDIENCE_ID="16be44bf-fc35-4bce-8e8f-78467cc55b0d"
if ! grep -q '^RESEND_NEWSLETTER_AUDIENCE_ID=' "${PROJECT_DIR}/.env"; then
    log "injecting RESEND_NEWSLETTER_AUDIENCE_ID into .env"
    echo "RESEND_NEWSLETTER_AUDIENCE_ID=${NEWSLETTER_AUDIENCE_ID}" >> "${PROJECT_DIR}/.env"
    chmod 600 "${PROJECT_DIR}/.env"
fi

# Ensure Elshan is in STAFF_EMAILS — required for admin endpoints
# (/v1/admin/* gated by req.isStaff which is set when JWT email is in
# STAFF_EMAILS). Idempotent: append email to comma-separated list only
# if missing.
STAFF_EMAIL_TO_ENSURE="elshan.musayev@ekmgc.de"
if grep -q '^STAFF_EMAILS=' "${PROJECT_DIR}/.env"; then
    if ! grep -qE "^STAFF_EMAILS=.*${STAFF_EMAIL_TO_ENSURE}" "${PROJECT_DIR}/.env"; then
        log "appending ${STAFF_EMAIL_TO_ENSURE} to existing STAFF_EMAILS"
        sed -i.bak "s|^STAFF_EMAILS=\(.*\)$|STAFF_EMAILS=\1,${STAFF_EMAIL_TO_ENSURE}|" "${PROJECT_DIR}/.env"
        rm -f "${PROJECT_DIR}/.env.bak"
    fi
else
    log "creating STAFF_EMAILS with ${STAFF_EMAIL_TO_ENSURE}"
    echo "STAFF_EMAILS=${STAFF_EMAIL_TO_ENSURE}" >> "${PROJECT_DIR}/.env"
fi
chmod 600 "${PROJECT_DIR}/.env"

# ─── 2. Pull the new API image ────────────────────────────────────────────
log "pulling latest API image…"
docker compose -f docker-compose.prod.yml pull api

# Save a recoverable database snapshot before additive schema changes.
log "backing up database before migrations…"
docker compose -f docker-compose.prod.yml exec -T db sh -c 'umask 077; pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "/backups/pre-release-$(date -u +%Y%m%dT%H%M%SZ).dump"' \
  || fail "database backup failed; existing API remains running"

# Apply additive migrations from the new image before serving new routes.
log "running migrations before API restart…"
docker compose -f docker-compose.prod.yml run --rm --no-deps api node apps/api/dist/db/migrate.js \
  || fail "migrations failed; existing API remains running"

# ─── 3. Rolling restart — start new api, keep db/redis warm ───────────────
log "starting / updating containers…"
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# ─── 4. Wait for API health ───────────────────────────────────────────────
log "waiting for API health…"
for i in {1..30}; do
    if curl -fsS --max-time 2 http://127.0.0.1:4000/healthz >/dev/null 2>&1; then
        log "API healthy"
        break
    fi
    [[ $i -eq 30 ]] && fail "API did not come up within 60s"
    sleep 2
done


# ─── 6. Prune stale images ────────────────────────────────────────────────
log "pruning dangling images…"
docker image prune -f >/dev/null

log "deploy complete ✓"
