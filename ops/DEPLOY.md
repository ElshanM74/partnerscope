# PartnerScope — Deploy Playbook

Single-node production stack on Hetzner Cloud. Target: from zero to live
`https://partnerscope.eu` in ~45 minutes, most of which is DNS propagation.

## Architecture

```
                    ┌─────────────────────────────────────────┐
   DNS (A/AAAA)     │  Hetzner CX22 (Ubuntu 24.04, €4.49/mo)  │
   ──────────────▶  │                                         │
   partnerscope.eu  │  nginx (host)  :80 → 443                │
   api.partner...eu │    ├─ /var/www/partnerscope/web  (Astro)│
   www.partner...eu │    └─ 127.0.0.1:4000  (Fastify API)     │
                    │                                         │
                    │  docker compose:                        │
                    │    • api   (Fastify + Puppeteer)        │
                    │    • db    (Postgres 16, volume)        │
                    │    • redis (cache + future BullMQ)      │
                    │                                         │
                    │  certbot (Let's Encrypt, auto-renew)    │
                    └─────────────────────────────────────────┘
```

## One-time setup (do this once, then forget)

### 1. DNS records — set these at your registrar BEFORE creating the server

Propagation takes 5–60 min; start DNS first so it's ready when the server is.

Replace `<SERVER_IPV4>` and `<SERVER_IPV6>` with values you get from Hetzner
after server creation (step 2).

| Type | Name                   | Value              | TTL |
|------|------------------------|--------------------|-----|
| A    | `@` (partnerscope.eu)  | `<SERVER_IPV4>`    | 300 |
| A    | `www`                  | `<SERVER_IPV4>`    | 300 |
| A    | `api`                  | `<SERVER_IPV4>`    | 300 |
| AAAA | `@`                    | `<SERVER_IPV6>`    | 300 |
| AAAA | `www`                  | `<SERVER_IPV6>`    | 300 |
| AAAA | `api`                  | `<SERVER_IPV6>`    | 300 |

### Resend DNS (email delivery for hello@partnerscope.eu and noreply@)

From Resend Dashboard → Domains → Add `partnerscope.eu`, then paste the
records it shows. Typically:

| Type | Name                      | Value                                                  |
|------|---------------------------|--------------------------------------------------------|
| MX   | `send`                    | `feedback-smtp.eu-west-1.amazonses.com` priority 10    |
| TXT  | `send`                    | `v=spf1 include:amazonses.com ~all`                    |
| TXT  | `resend._domainkey`       | (long DKIM string, copy verbatim from Resend)          |
| TXT  | `_dmarc`                  | `v=DMARC1; p=none;`                                    |

Verify in Resend Dashboard once propagated (`dig TXT resend._domainkey.partnerscope.eu`).

### 2. Create a deploy SSH key (on your laptop)

```bash
ssh-keygen -t ed25519 -C "partnerscope-deploy" -f ~/.ssh/partnerscope_deploy
# Public half goes into cloud-init.yaml and GitHub.
# Private half goes into GitHub Actions secret DEPLOY_SSH_KEY.
```

### 3. Create the Hetzner server

1. Hetzner Cloud Console → New Project "partnerscope" → Add Server.
2. **Location**: Nuremberg or Falkenstein (closer to Baden-Baden → low latency).
3. **Image**: Ubuntu 24.04.
4. **Type**: CX22 (€4.49/mo, 2 vCPU / 4GB RAM / 40GB). Upgrade to CX32 if traffic warrants.
5. **Networking**: IPv4 + IPv6, both enabled.
6. **SSH keys**: add your laptop key (the one from `~/.ssh/id_ed25519.pub`).
7. **User data**: paste contents of `ops/cloud-init.yaml` AFTER replacing:
   - `{{SSH_PUBLIC_KEY}}` → your laptop pubkey (`cat ~/.ssh/id_ed25519.pub`)
   - `{{DEPLOY_SSH_PUBLIC_KEY}}` → the deploy pubkey (`cat ~/.ssh/partnerscope_deploy.pub`)
8. Create. Wait ~3–5 minutes for cloud-init to finish.

Copy the server's IPv4 and IPv6 into the DNS records above.

### 4. First SSH in — verify cloud-init finished

```bash
ssh deploy@<SERVER_IPV4>
# Once inside:
ls /var/lib/partnerscope-cloud-init-done   # must exist
docker --version                            # must work
sudo systemctl status nginx                 # must be active
```

If something looks wrong: `sudo cat /var/log/cloud-init-output.log`.

### 5. Install `.env` on the server (ONCE — secrets never in git)

```bash
# On the server, as `deploy`:
cd /opt/partnerscope
nano .env                 # paste from ops/env.prod.example, fill real values
chmod 600 .env

# Generate strong secrets for placeholders:
openssl rand -hex 32      # use twice, for JWT_SECRET and SESSION_SECRET
openssl rand -base64 48   # POSTGRES_PASSWORD
```

Minimum required to boot:
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `SESSION_SECRET`
- `GITHUB_REPOSITORY=elshanmusayev/partnerscope-platform` (your exact repo path)

Optional (deploy runs without them, features degrade gracefully):
- `RESEND_API_KEY` — without it, emails log to stdout only
- `STRIPE_*` — without it, /get-started still works (manual reply flow)

### 6. First TLS certificates (Let's Encrypt)

With DNS propagated and nginx running (but without cert yet), request certs:

```bash
# On the server, as deploy:
sudo certbot --nginx -d partnerscope.eu -d www.partnerscope.eu \
  --email elshan.musayev@ekmgc.de \
  --agree-tos \
  --no-eff-email \
  --redirect

sudo certbot --nginx -d api.partnerscope.eu \
  --email elshan.musayev@ekmgc.de \
  --agree-tos \
  --no-eff-email \
  --redirect
```

certbot autoconfigures nginx + installs a systemd timer for 60-day renewals.
Verify renewal works without actually renewing:

```bash
sudo certbot renew --dry-run
```

### 7. GitHub Actions — add these repository secrets

Settings → Secrets and variables → Actions → New repository secret:

| Name                     | Value                                               |
|--------------------------|-----------------------------------------------------|
| `DEPLOY_HOST`            | `<SERVER_IPV4>` (or `partnerscope.eu`)              |
| `DEPLOY_USER`            | `deploy`                                            |
| `DEPLOY_SSH_KEY`         | contents of `~/.ssh/partnerscope_deploy` (private)  |
| `DEPLOY_SSH_KNOWN_HOSTS` | run: `ssh-keyscan -t ed25519 <SERVER_IPV4>`         |

Then under Settings → Environments → Create `production`.

### 8. First deploy — push main, watch the action

```bash
git push origin main
```

GitHub Actions → "Deploy" workflow → should build API, push to GHCR,
build Astro, rsync, and run `./deploy.sh` on the server. Total: ~4–6 min.

Once green, visit:
- https://partnerscope.eu → Astro site (legal pages, /plans, /get-started)
- https://api.partnerscope.eu/healthz → `{"status":"ok"}`

## Day-to-day operations

### Trigger a deploy
`git push origin main` — CI handles the rest. Or run the workflow manually
via Actions → Deploy → Run workflow.

### Update `.env`
```bash
ssh deploy@partnerscope.eu
cd /opt/partnerscope
nano .env
./deploy.sh                # restarts api with new env
```

### Database backup (manual, quick)
```bash
ssh deploy@partnerscope.eu
cd /opt/partnerscope
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U partnerscope partnerscope > backups/$(date +%Y%m%d-%H%M%S).sql
```

Automate with a cron later (see `ops/backup.sh` — TODO in a later wave).

### Read API logs
```bash
ssh deploy@partnerscope.eu
cd /opt/partnerscope
docker compose -f docker-compose.prod.yml logs -f --tail=200 api
```

### Read nginx logs
```bash
sudo tail -f /var/log/nginx/api.access.log
sudo tail -f /var/log/nginx/api.error.log
```

### Rollback
```bash
# Find the previous image tag
docker images | grep partnerscope

# Pin to it in .env, then redeploy
nano /opt/partnerscope/.env          # set API_IMAGE_TAG=sha-abc1234
./deploy.sh
```

## Cost breakdown (monthly)

| Item                       | EUR     | Notes                                |
|----------------------------|---------|--------------------------------------|
| Hetzner CX22               | 4.49    | 2 vCPU, 4 GB RAM, 40 GB NVMe         |
| Hetzner IPv4 addon         | 0.50    | IPv6 free                            |
| Hetzner backups (20%)      | 0.90    | Optional but recommended             |
| Domain partnerscope.eu     | ~1.00   | Amortized (€12–15/year)              |
| Resend (free tier)         | 0       | 100 emails/day, 3000/month free      |
| Cloudflare DNS             | 0       | Free tier is plenty                  |
| GitHub Actions             | 0       | 2000 CI minutes/month free on public |
| GHCR storage               | 0       | Free for public, 500MB for private   |
| **Total**                  | **~7€** | until you outgrow it                 |

When you outgrow CX22 (~5000 concurrent users, or you add heavy PDF rendering):
upgrade to CX32 (€6.19/mo, 4 vCPU / 8GB) or CPX31 (€13.79/mo, 4 dedicated vCPU).

## Troubleshooting

**`nginx -t` fails after rsync**
→ `sudo cat /etc/nginx/sites-available/partnerscope.conf` — compare with `ops/nginx.conf`. certbot may have mutated it (it usually plays nice but check).

**API returns 502 Bad Gateway**
→ `docker compose logs api` on the server. Most common: a new env var is required and `.env` wasn't updated. Restart: `docker compose restart api`.

**GitHub Actions fails at "Run deploy.sh" with permission denied**
→ The deploy key's public half isn't on the server. SSH in manually with your laptop key, then `echo '<pubkey>' >> ~/.ssh/authorized_keys`.

**Let's Encrypt rate-limited (5 certs / domain / week)**
→ `sudo certbot certificates` — confirm certs exist. If you hit the limit testing, use `--staging` next time.

**Hetzner server IPv6 not reaching externally**
→ Check `ip -6 addr show` on the server. If empty, the `AAAA` record is pointing nowhere. Cloud-init should configure IPv6 automatically; if it didn't, use Hetzner Console → Server → Networking → Enable IPv6.
