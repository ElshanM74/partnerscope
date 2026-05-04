/**
 * Drizzle schema — mirrors migrations/001_initial_schema.sql.
 *
 * This file is the TypeScript view of the DB. SQL migrations remain the
 * source of truth; do NOT use `drizzle-kit push` to mutate prod schemas.
 */

import {
  bigserial,
  boolean,
  char,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// CITEXT is backed by `text()` at the Drizzle layer — the physical column
// remains CITEXT via migrations/001_initial_schema.sql, which is what
// makes case-insensitive uniqueness work in Postgres.
const citext = text;

// ────────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────────

export const tierEnum = pgEnum('tier_enum', ['free_snapshot', 'starter', 'pro', 'enterprise']);
export const riskBandEnum = pgEnum('risk_band', ['HIGH', 'MEDIUM', 'LOW', 'MINIMAL']);
export const runStatusEnum = pgEnum('run_status', [
  'draft',
  'queued',
  'running',
  'analyst_review',
  'qa_review',
  'delivered',
  'failed',
  'cancelled',
  'archived',
]);
export const testStatusEnum = pgEnum('test_status', ['pass', 'warn', 'fail', 'error']);
export const docStatusEnum = pgEnum('doc_status', ['pending', 'received', 'verified', 'rejected']);
export const userRoleEnum = pgEnum('user_role', ['viewer', 'admin', 'analyst', 'qa']);

// ────────────────────────────────────────────────────────────────
// Tables
// ────────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  country: char('country', { length: 2 }).notNull(),
  vatId: text('vat_id'),
  billingEmail: citext('billing_email').notNull(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  apiKeyHash: text('api_key_hash').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, {
    onDelete: 'cascade',
  }),
  email: citext('email').unique().notNull(),
  fullName: text('full_name'),
  role: userRoleEnum('role').default('viewer').notNull(),
  passwordHash: text('password_hash'),
  ssoSubject: text('sso_subject'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    legalName: text('legal_name').notNull(),
    domain: text('domain').notNull(),
    country: char('country', { length: 2 }),
    industry: text('industry'),
    externalRef: text('external_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgDomainUniq: unique('vendors_org_domain_key').on(t.organizationId, t.domain),
  }),
);

export const questions = pgTable('questions', {
  id: text('id').primaryKey(),
  dimensionCode: char('dimension_code', { length: 3 }).notNull(),
  cluster: text('cluster').notNull(),
  tierGates: tierEnum('tier_gates').array().notNull(),
  questionType: text('question_type').notNull(),
  weight: numeric('weight', { precision: 4, scale: 2 }).default('1.0').notNull(),
  prompt: text('prompt').notNull(),
  evidenceHint: text('evidence_hint'),
  scoringRubric: jsonb('scoring_rubric').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  frameworkVersion: text('framework_version').default('13.0').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  tier: tierEnum('tier').notNull(),
  requestedBy: uuid('requested_by').references(() => users.id),
  status: runStatusEnum('status').default('draft').notNull(),
  slaHours: integer('sla_hours').default(0).notNull(),
  compositeScore: integer('composite_score'),
  riskBand: riskBandEnum('risk_band'),
  hardRedFlag: boolean('hard_red_flag').default(false),
  capReason: text('cap_reason'),
  scoringVersion: text('scoring_version'),
  frameworkVersion: text('framework_version'),
  stripePaymentIntent: text('stripe_payment_intent'),
  reportPdfUrl: text('report_pdf_url'),
  reportJson: jsonb('report_json'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const responses = pgTable(
  'responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    rawAnswer: jsonb('raw_answer').notNull(),
    numericScore: integer('numeric_score'),
    analystNotes: text('analyst_notes'),
    answeredAt: timestamp('answered_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runQuestionUniq: unique('responses_run_question_key').on(t.runId, t.questionId),
  }),
);

export const testResults = pgTable('test_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  testId: text('test_id').notNull(),
  dimensionCode: char('dimension_code', { length: 3 }).notNull(),
  status: testStatusEnum('status').notNull(),
  score: integer('score'),
  evidenceUrl: text('evidence_url'),
  evidenceSha256: char('evidence_sha256', { length: 64 }),
  rawPayload: jsonb('raw_payload'),
  runtimeMs: integer('runtime_ms'),
  executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const dimensionScores = pgTable(
  'dimension_scores',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    dimensionCode: char('dimension_code', { length: 3 }).notNull(),
    score: integer('score').notNull(),
    band: riskBandEnum('band').notNull(),
    findings: jsonb('findings'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.dimensionCode] }),
  }),
);

export const evidenceDocuments = pgTable('evidence_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  dimensionCode: char('dimension_code', { length: 3 }),
  docType: text('doc_type').notNull(),
  filename: text('filename').notNull(),
  s3Url: text('s3_url').notNull(),
  sha256: char('sha256', { length: 64 }).notNull(),
  status: docStatusEnum('status').default('received').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewerNotes: text('reviewer_notes'),
});

export const redteamResults = pgTable('redteam_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  payloadId: text('payload_id').notNull(),
  category: text('category').notNull(),
  subType: text('sub_type'),
  outcome: text('outcome').notNull(),
  severity: text('severity'),
  evidenceSanitized: text('evidence_sanitized'),
  analystId: uuid('analyst_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const monitoringSignals = pgTable('monitoring_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id, { onDelete: 'cascade' }),
  signalCode: text('signal_code').notNull(),
  severity: text('severity').notNull(),
  payload: jsonb('payload'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
  ackedAt: timestamp('acked_at', { withTimezone: true }),
  ackedBy: uuid('acked_by').references(() => users.id),
});

export const demoLeads = pgTable('demo_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull(),
  company: text('company'),
  vendorDomain: text('vendor_domain').notNull(),
  answers: jsonb('answers').notNull(),
  snapshotScore: integer('snapshot_score'),
  riskBand: riskBandEnum('risk_band'),
  convertedRunId: uuid('converted_run_id').references(() => runs.id),
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorIp: text('actor_ip'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: uuid('resource_id'),
  payload: jsonb('payload'),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
});

// Password reset tokens. One row per forgot-password request; token_hash is
// sha256 of the URL-safe random token (raw token is never stored). A token is
// "spent" once `used_at` is set. See migrations/003_password_reset_tokens.sql.
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// APNs / FCM device registration for native push notifications.
// One row per (user, device_token); upsert on conflict refreshes last_seen_at.
// See migrations/002_push_devices.sql for schema details.
export const pushDevices = pgTable(
  'push_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceToken: text('device_token').notNull(),
    platform: text('platform').notNull(), // 'ios' | 'android'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userDeviceUniq: unique('push_devices_user_device_key').on(t.userId, t.deviceToken),
  }),
);
