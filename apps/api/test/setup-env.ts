/**
 * Test-time environment shim.
 *
 * Loaded via `vitest.config.ts` setupFiles BEFORE any test file imports
 * `src/config/env.ts`, so the Zod-validated config has everything it needs
 * to parse successfully — no DB, no Stripe, no Resend in CI.
 */

process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'error';
process.env.DATABASE_URL ??= 'postgres://localhost:5432/partnerscope_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

// Stripe dummies — enough to construct the client and satisfy signature tests.
process.env.STRIPE_SECRET_KEY ??= 'sk_test_unit_dummy_key_do_not_use';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy_secret_for_unit_tests_only';
process.env.STRIPE_PRICE_STARTER ??= 'price_starter_dummy';
process.env.STRIPE_PRICE_PRO_INTRO ??= 'price_pro_intro_dummy';
process.env.STRIPE_PRICE_ENTERPRISE ??= 'price_enterprise_dummy';

// Resend left undefined on purpose — email service should be in dry-run mode.

process.env.JWT_SECRET ??= 'dev_only_change_me_dev_only_change_me';
process.env.SESSION_SECRET ??= 'dev_only_change_me_dev_only_change_me';
