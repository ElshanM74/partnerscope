# PartnerScope Platform

B2B third-party AI risk assessment platform.
Assesses vendors across 13 dimensions (behavioural, financial, AI & compliance)
with automated tests, documentary review, and AI red-teaming.
Aligned with EU AI Act, GDPR, DORA, and NIS2.

- **Domain:** partnerscope.eu
- **Owner:** EKM Global Consulting GmbH — Elshan Musayev
- **Status:** v2.0 (3-tier consolidation — Starter €99 / Pro €499 / Enterprise €4 900 qtr)

---

## Repository layout

```
partnerscope-platform/
├── apps/
│   └── api/                 # Fastify HTTP API (v1)
├── packages/
│   └── core/                # Shared domain: dimensions, scoring, crosswalk, types
├── migrations/              # PostgreSQL SQL migrations (raw, idempotent)
├── docs/
│   └── partnerscope-spec/   # Full integration blueprint (32 files) — source of truth
├── scripts/                 # Seed, maintenance, ops scripts
└── .github/workflows/       # CI
```

---

## Prerequisites

- Node.js ≥ 20.10
- pnpm ≥ 9
- PostgreSQL 16+
- Redis 7+ (queues, rate limiting)
- Docker (optional, for local infra)

---

## Quick start

```bash
# Install
pnpm install

# Bootstrap infra (Postgres + Redis via Docker)
docker compose up -d

# Copy env and fill secrets
cp .env.example .env

# Run DB migrations + seed 78 questions
pnpm db:migrate
pnpm db:seed

# Run everything in watch mode
pnpm dev
```

The API listens on `http://localhost:4000`.
OpenAPI docs (dev): `http://localhost:4000/docs`.

---

## Common commands

| Command | Purpose |
|---|---|
| `pnpm build` | Build all packages + apps |
| `pnpm dev` | Run all apps in watch mode |
| `pnpm test` | Run Vitest across workspaces |
| `pnpm lint` | Biome lint + format check |
| `pnpm lint:fix` | Auto-fix Biome issues |
| `pnpm typecheck` | TS type-check across workspaces |
| `pnpm db:migrate` | Apply SQL migrations |
| `pnpm db:seed` | Seed reference data (13 dimensions, 78 questions) |

---

## Architecture (v2)

- **Language:** TypeScript everywhere
- **API:** Fastify 5 (schema-first via Zod)
- **DB:** PostgreSQL 16 via Drizzle ORM + raw SQL migrations
- **Queue:** BullMQ on Redis
- **PDF:** Puppeteer + HTML/CSS templates
- **Auth:** Bearer API keys per organization + session JWT for web
- **Email:** Resend
- **Billing:** Stripe (3 SKUs + add-vendor metered)

Domain logic (scoring, dimensions, question bank, compliance crosswalk) lives in
`packages/core` — framework-free, unit-testable, deterministic.

---

## Source of truth

All product, scoring, tier, and regulatory rules live under
[`docs/partnerscope-spec/`](docs/partnerscope-spec/INDEX.md). Code must match
the spec; if the spec and code disagree, the spec wins — update the code.

---

## License

UNLICENSED — internal EKM Global Consulting GmbH property.
