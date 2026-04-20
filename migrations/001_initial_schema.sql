-- ──────────────────────────────────────────────────────────────────
-- PartnerScope platform — initial schema
-- Source: docs/partnerscope-spec/06_api_schemas/db_schema.sql
-- PostgreSQL 16+
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ==========================================================================
-- EXTENSIONS
-- ==========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ==========================================================================
-- ENUMS
-- ==========================================================================

DO $$ BEGIN
  CREATE TYPE tier_enum AS ENUM ('free_snapshot', 'starter', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_band AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'MINIMAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE run_status AS ENUM (
    'draft',
    'queued',
    'running',
    'analyst_review',
    'qa_review',
    'delivered',
    'failed',
    'cancelled',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE test_status AS ENUM ('pass', 'warn', 'fail', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_status AS ENUM ('pending', 'received', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('viewer', 'admin', 'analyst', 'qa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ==========================================================================
-- updated_at trigger helper
-- ==========================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==========================================================================
-- CORE: organizations, users, vendors
-- ==========================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  legal_name          TEXT NOT NULL,
  country             CHAR(2) NOT NULL,
  vat_id              TEXT,
  billing_email       CITEXT NOT NULL,
  stripe_customer_id  TEXT UNIQUE,
  api_key_hash        TEXT UNIQUE,        -- bcrypt/argon2 hash of bearer API key
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_orgs_updated ON organizations;
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  email            CITEXT UNIQUE NOT NULL,
  full_name        TEXT,
  role             user_role NOT NULL DEFAULT 'viewer',
  password_hash    TEXT,
  sso_subject      TEXT,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);

CREATE TABLE IF NOT EXISTS vendors (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_name       TEXT NOT NULL,
  domain           TEXT NOT NULL,
  country          CHAR(2),
  industry         TEXT,
  external_ref     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_vendors_org    ON vendors(organization_id);
CREATE INDEX IF NOT EXISTS idx_vendors_domain ON vendors(domain);

-- ==========================================================================
-- Reference data: questions (seeded from packages/core)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS questions (
  id               TEXT PRIMARY KEY,
  dimension_code   CHAR(3) NOT NULL,
  cluster          TEXT NOT NULL CHECK (cluster IN ('behavioral','financial','ai_compliance')),
  tier_gates       tier_enum[] NOT NULL,
  question_type    TEXT NOT NULL CHECK (question_type IN
                    ('likert','multi_select','single_select','free_form','document_upload')),
  weight           NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  prompt           TEXT NOT NULL,
  evidence_hint    TEXT,
  scoring_rubric   JSONB NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  framework_version TEXT NOT NULL DEFAULT '13.0',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_questions_updated ON questions;
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_questions_dim ON questions(dimension_code);

-- ==========================================================================
-- Runs + responses
-- ==========================================================================

CREATE TABLE IF NOT EXISTS runs (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id                UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  organization_id          UUID NOT NULL REFERENCES organizations(id),
  tier                     tier_enum NOT NULL,
  requested_by             UUID REFERENCES users(id),
  status                   run_status NOT NULL DEFAULT 'draft',
  sla_hours                INT NOT NULL DEFAULT 0,
  composite_score          INT CHECK (composite_score BETWEEN 0 AND 100),
  risk_band                risk_band,
  hard_red_flag            BOOLEAN DEFAULT false,
  cap_reason               TEXT,
  scoring_version          TEXT,
  framework_version        TEXT,
  stripe_payment_intent    TEXT,
  report_pdf_url           TEXT,
  report_json              JSONB,
  started_at               TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  archived_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_runs_updated ON runs;
CREATE TRIGGER trg_runs_updated BEFORE UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_runs_vendor  ON runs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_runs_org     ON runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_runs_status  ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);

CREATE TABLE IF NOT EXISTS responses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id         UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  question_id    TEXT NOT NULL REFERENCES questions(id),
  raw_answer     JSONB NOT NULL,
  numeric_score  INT CHECK (numeric_score BETWEEN 0 AND 100),
  analyst_notes  TEXT,
  answered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_responses_run ON responses(run_id);

-- ==========================================================================
-- Automated test results + dimension scores
-- ==========================================================================

CREATE TABLE IF NOT EXISTS test_results (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id         UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  test_id        TEXT NOT NULL,
  dimension_code CHAR(3) NOT NULL,
  status         test_status NOT NULL,
  score          INT CHECK (score BETWEEN 0 AND 100),
  evidence_url   TEXT,
  evidence_sha256 CHAR(64),
  raw_payload    JSONB,
  runtime_ms     INT,
  executed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_results_run  ON test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_test_results_test ON test_results(test_id);

CREATE TABLE IF NOT EXISTS dimension_scores (
  run_id         UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  dimension_code CHAR(3) NOT NULL,
  score          INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  band           risk_band NOT NULL,
  findings       JSONB,
  PRIMARY KEY (run_id, dimension_code)
);

-- ==========================================================================
-- Evidence documents + red-team results
-- ==========================================================================

CREATE TABLE IF NOT EXISTS evidence_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  dimension_code  CHAR(3),
  doc_type        TEXT NOT NULL,
  filename        TEXT NOT NULL,
  s3_url          TEXT NOT NULL,
  sha256          CHAR(64) NOT NULL,
  status          doc_status NOT NULL DEFAULT 'received',
  uploaded_by     UUID REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewer_notes  TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence_documents(run_id);

CREATE TABLE IF NOT EXISTS redteam_results (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id             UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  payload_id         TEXT NOT NULL,
  category           TEXT NOT NULL CHECK (category IN
                      ('prompt_injection','jailbreak','pii_leakage','bias','robustness','agentic')),
  sub_type           TEXT,
  outcome            TEXT NOT NULL CHECK (outcome IN ('blocked','partial','succeeded')),
  severity           TEXT CHECK (severity IN ('low','medium','high','critical')),
  evidence_sanitized TEXT,
  analyst_id         UUID REFERENCES users(id),
  reviewed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_redteam_run ON redteam_results(run_id);

-- ==========================================================================
-- Continuous monitoring (Enterprise)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS monitoring_signals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id    UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  signal_code  TEXT NOT NULL,
  severity     TEXT NOT NULL,
  payload      JSONB,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at     TIMESTAMPTZ,
  acked_by     UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_monitoring_vendor ON monitoring_signals(vendor_id, detected_at DESC);

-- ==========================================================================
-- Billing (Stripe)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id         UUID NOT NULL REFERENCES organizations(id),
  stripe_subscription_id  TEXT UNIQUE,
  product                 TEXT NOT NULL,
  status                  TEXT NOT NULL,
  current_period_end      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id        UUID NOT NULL REFERENCES organizations(id),
  run_id                 UUID REFERENCES runs(id),
  stripe_payment_intent  TEXT UNIQUE,
  amount_cents           INT NOT NULL,
  currency               CHAR(3) NOT NULL DEFAULT 'EUR',
  status                 TEXT NOT NULL,
  paid_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(organization_id);

-- ==========================================================================
-- Audit log
-- ==========================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  actor_user_id  UUID REFERENCES users(id),
  actor_ip       INET,
  action         TEXT NOT NULL,
  resource_type  TEXT,
  resource_id    UUID,
  payload        JSONB,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor    ON audit_log(actor_user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);

-- ==========================================================================
-- Free snapshot lead magnet
-- ==========================================================================

CREATE TABLE IF NOT EXISTS demo_leads (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             CITEXT NOT NULL,
  company           TEXT,
  vendor_domain     TEXT NOT NULL,
  answers           JSONB NOT NULL,
  snapshot_score    INT,
  risk_band         risk_band,
  converted_run_id  UUID REFERENCES runs(id),
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demo_leads_email ON demo_leads(email, created_at DESC);

-- ==========================================================================
-- Views
-- ==========================================================================

CREATE OR REPLACE VIEW v_portfolio_summary AS
SELECT
  o.id            AS organization_id,
  o.legal_name,
  COUNT(DISTINCT v.id)                                           AS vendor_count,
  COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'delivered')     AS reports_delivered,
  COUNT(*)         FILTER (WHERE r.hard_red_flag)                AS red_flag_count,
  AVG(r.composite_score) FILTER (WHERE r.status = 'delivered')   AS avg_score
FROM organizations o
LEFT JOIN vendors v  ON v.organization_id = o.id
LEFT JOIN runs    r  ON r.organization_id = o.id
GROUP BY o.id, o.legal_name;

COMMIT;
