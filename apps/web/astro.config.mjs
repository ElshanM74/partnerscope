// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

/**
 * PartnerScope marketing site config.
 *
 * Static build; canonical host is partnerscope.eu.
 * Redirects here cover in-domain rewrites: /pricing → /plans and
 * /privacy → /legal/privacy (canonical location of the privacy policy).
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
    // Short-URL redirect for the privacy policy so external consumers that
    // declared /privacy (e.g. Google Play Console's App Content field, older
    // business-card copy, third-party directories) resolve correctly. The
    // canonical path is /legal/privacy — all internal links use that form.
    '/privacy': {
      status: 301,
      destination: '/legal/privacy',
    },
    // German marketing apex → /de/plans (matches /pricing → /plans for EN).
    '/de': {
      status: 301,
      destination: '/de/plans',
    },
  },
  integrations: [
    sitemap({
      // Keep funnel + authenticated app shells out of the index. These routes
      // are built as static pages on this domain but have no public SEO value:
      //   /checkout(/success), /get-started (signup CTA), and the app/auth/error
      //   shells (/account, /admin, /dashboard, /login, /forgot-password,
      //   /reset-password, /404) — including their /de localised variants.
      filter: (page) => {
        const { pathname } = new URL(page);
        // strip an optional /de localisation prefix so EN + DE share one rule set
        const route = pathname.replace(/^\/de(?=\/|$)/, '') || '/';
        const EXCLUDED = [
          '/checkout',
          '/get-started',
          '/signup',
          '/account',
          '/admin',
          '/dashboard',
          '/login',
          '/forgot-password',
          '/reset-password',
          '/404',
        ];
        return !EXCLUDED.some((seg) => route === seg || route.startsWith(`${seg}/`));
      },
      changefreq: 'weekly',
      priority: 0.7,
    }),
  ],
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
