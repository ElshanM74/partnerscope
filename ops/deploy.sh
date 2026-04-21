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
if [[ -f "${NGINX_CONF_SRC}" ]]; then
    sudo cp "${NGINX_CONF_SRC}" "${NGINX_CONF_DST}"
    sudo ln -sf "${NGINX_CONF_DST}" "${NGINX_CONF_LINK}"
    sudo nginx -t || fail "nginx config test failed — not reloading"
    sudo systemctl reload nginx
    log "nginx reloaded"
fi

# ─── 2. Pull the new API image ────────────────────────────────────────────
log "pulling latest API image…"
docker compose -f docker-compose.prod.yml pull api

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

# ─── 5. Run DB migrations (idempotent) ────────────────────────────────────
log "running migrations…"
docker compose -f docker-compose.prod.yml exec -T api node apps/api/dist/db/migrate.js \
  || fail "migrations failed"

# ─── 6. Prune stale images ────────────────────────────────────────────────
log "pruning dangling images…"
docker image prune -f >/dev/null

log "deploy complete ✓"
