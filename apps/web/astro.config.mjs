// @ts-check
import { defineConfig } from 'astro/config';

/**
 * PartnerScope marketing site config.
 *
 * Static build; canonical host is partnerscope.eu.
 * Redirects here cover the in-domain rewrite /pricing → /plans.
 * The apex → /plans home and the legacy b2b.partnerscope.eu/* → partnerscope.eu/plans
 * rewrites are handled at the edge (nginx / CDN) — documented in ops/README.
 */
export default defineConfig({
  site: 'https://partnerscope.eu',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  redirects: {
    '/pricing': {
      status: 301,
      destination: '/plans',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  vite: {
    server: {
      host: '0.0.0.0',
      port: 5173,
    },
  },
});
