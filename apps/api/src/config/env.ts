/**
 * Validated runtime config. Fails fast on missing/invalid env vars.
 */

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  API_CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Optional — presence-gated features in later waves.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default('PartnerScope <noreply@partnerscope.eu>'),
  RESEND_REPLY_TO: z.string().default('hello@partnerscope.eu'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO_INTRO: z.string().optional(),
  STRIPE_PRICE_PRO_QUARTERLY: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),
  STRIPE_SUCCESS_URL: z.string().url().default('http://localhost:5173/checkout/success'),
  STRIPE_CANCEL_URL: z.string().url().default('http://localhost:5173/plans'),

  OPENAI_API_KEY: z.string().optional(),

  // Storage — local disk by default; S3 fallback for prod.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),

  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),

  JWT_SECRET: z.string().min(16).default('dev_only_change_me_dev_only_change_me'),
  SESSION_SECRET: z.string().min(16).default('dev_only_change_me_dev_only_change_me'),

  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('✖ Invalid environment config:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
