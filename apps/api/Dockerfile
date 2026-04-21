# ─── PartnerScope API — multi-stage Docker image ────────────────────────
# Base: Debian slim so Puppeteer's bundled Chromium has its shared-library deps.
# (Alpine triples the image size once we install chromium-headless.)

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/usr/local/pnpm \
    PATH=/usr/local/pnpm:$PATH \
    NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=false
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Chromium runtime deps for Puppeteer PDF rendering.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# ─── Stage: dependency layer (exploits Docker cache) ────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/tests/package.json ./packages/tests/package.json
RUN pnpm install --frozen-lockfile --prod=false

# ─── Stage: build ───────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @partnerscope/core build \
 && pnpm --filter @partnerscope/tests build \
 && pnpm --filter @partnerscope/api build

# ─── Stage: runtime (slim) ──────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app
RUN groupadd --system --gid 1001 api \
 && useradd --system --uid 1001 --gid api --no-create-home api \
 && mkdir -p /app/storage && chown -R api:api /app

# Only runtime deps.
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/tests/package.json ./packages/tests/package.json
RUN pnpm install --frozen-lockfile --prod

# Built artefacts.
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/tests/dist ./packages/tests/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
# Handlebars templates and static assets shipped next to sources.
COPY --from=build /app/apps/api/src/services/email/templates ./apps/api/dist/services/email/templates
COPY --from=build /app/apps/api/src/services/pdf/templates ./apps/api/dist/services/pdf/templates

ENV NODE_ENV=production \
    API_PORT=4000 \
    STORAGE_LOCAL_DIR=/app/storage

USER api
EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/server.js"]
