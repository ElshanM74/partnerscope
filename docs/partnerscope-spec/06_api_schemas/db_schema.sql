-- PartnerScope Database Schema
-- PostgreSQL 16+
-- Version: 1.0
-- Last updated: 2026-04-20

-- ==========================================================================
-- EXTENSIONS
-- ==========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ==========================================================================
-- ENUMS
-- ==========================================================================

CREATE TYPE tier_enum AS ENUM ('free_snapshot', 'starter', 'pro', 'enterprise');
CREATE TYPE risk_band AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'MINIMAL');
CREATE TYPE run_status AS ENUM ('queued', 'running', 'analyst_review', 'qa_review', 'delivered', 'failed', 'cancelled');
CREATE TYPE test_status AS ENUM ('pass', 'warn', 'fail', 'error');
CREATE TYPE doc_status AS ENUM ('pending', 'received', 'verified', 'rejected');

-- ==========================================================================
-- CORE ENTITIES
-- ==========================================================================

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legal_name TEXT NOT NULL,
    country CHAR(2) NOT NULL,
    vat_id TEXT,
    billing_email CITEXT NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email CITEXT UNIQUE NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'viewer', -- viewer / analyst / admin
    password_hash TEXT,
    sso_subject TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    legal_name TEXT NOT NULL,
    domain TEXT NOT NULL,
    country CHAR(2),
    industry TEXT,
    external_ref TEXT, -- buyer's internal vendor id
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(organization_id, domain)
);

CREATE INDEX idx_vendors_org ON vendors(organization_id);
CREATE INDEX idx_vendors_domain ON vendors(domain);

-- ==========================================================================
-- ASSESSMENT RUNS
-- ==========================================================================

CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    tier tier_enum NOT NULL,
    requested_by UUID REFERENCES users(id),
    status run_status NOT NULL DEFAULT 'queued',
    sla_hours INT NOT NULL,
    composite_score INT CHECK (composite_score BETWEEN 0 AND 100),
    risk_band risk_band,
    hard_red_flag BOOLEAN DEFAULT false,
    cap_reason TEXT,
    stripe_payment_intent TEXT,
    report_pdf_url TEXT,
    report_json JSONB,
    started_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_vendor ON runs(vendor_id);
CREATE INDEX idx_runs_org ON runs(organization_id);
CREATE INDEX idx_runs_status ON runs(status);

-- ==========================================================================
-- QUESTIONNAIRE RESPONSES
-- ==========================================================================

CREATE TABLE questions (
    id TEXT PRIMARY KEY, -- Q01, Q02, ...
    dimension_code CHAR(3) NOT NULL, -- D01..D13
    cluster TEXT NOT NULL, -- behavioral / financial / ai_compliance
    tier_gate tier_enum NOT NULL,
    weight NUMERIC(4,2) NOT NULL,
    question_text TEXT NOT NULL,
    evidence_hint TEXT,
    scoring_rubric JSONB NOT NULL
);

CREATE TABLE responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES questions(id),
    raw_answer JSONB NOT NULL,
    numeric_score INT CHECK (numeric_score BETWEEN 0 AND 100),
    analyst_notes TEXT,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(run_id, question_id)
);

-- ==========================================================================
-- AUTOMATED TEST RESULTS
-- ==========================================================================

CREATE TABLE test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    test_id TEXT NOT NULL,
    dimension_code CHAR(3) NOT NULL,
    status test_status NOT NULL,
    score INT CHECK (score BETWEEN 0 AND 100),
    evidence_url TEXT,
    evidence_sha256 CHAR(64),
    raw_payload JSONB,
    runtime_ms INT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_test_results_run ON test_results(run_id);
CREATE INDEX idx_test_results_test ON test_results(test_id);

-- ==========================================================================
-- DIMENSION SCORES (DENORMALIZED)
-- ==========================================================================

CREATE TABLE dimension_scores (
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    dimension_code CHAR(3) NOT NULL,
    score INT NOT NULL CHECK (score BETWEEN 0 AND 100),
    band risk_band NOT NULL,
    findings JSONB,
    PRIMARY KEY (run_id, dimension_code)
);

-- ==========================================================================
-- DOCUMENTARY EVIDENCE
-- ==========================================================================

CREATE TABLE evidence_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    dimension_code CHAR(3),
    doc_type TEXT NOT NULL, -- DPA / ISO27001 / SOC2 / ModelCard / SBOM / BCP / IR_PLAN
    filename TEXT NOT NULL,
    s3_url TEXT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    status doc_status NOT NULL DEFAULT 'received',
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewer_notes TEXT
);

-- ==========================================================================
-- RED-TEAM RESULTS
-- ==========================================================================

CREATE TABLE redteam_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    payload_id TEXT NOT NULL,
    category TEXT NOT NULL, -- prompt_injection / jailbreak / pii_leakage / bias / robustness / agentic
    sub_type TEXT,
    outcome TEXT NOT NULL, -- blocked / partial / succeeded
    severity TEXT, -- low / medium / high / critical
    evidence_sanitized TEXT,
    analyst_id UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- CONTINUOUS MONITORING (Enterprise)
-- ==========================================================================

CREATE TABLE monitoring_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    signal_code TEXT NOT NULL, -- BREACH / SANCTION / ADVMEDIA / TLS_CHANGE / ...
    severity TEXT NOT NULL,
    payload JSONB,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acked_at TIMESTAMPTZ,
    acked_by UUID REFERENCES users(id)
);

CREATE INDEX idx_monitoring_vendor ON monitoring_signals(vendor_id, detected_at DESC);

-- ==========================================================================
-- BILLING
-- ==========================================================================

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    stripe_subscription_id TEXT UNIQUE,
    product TEXT NOT NULL, -- starter / pro / enterprise
    status TEXT NOT NULL,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    run_id UUID REFERENCES runs(id),
    stripe_payment_intent TEXT UNIQUE,
    amount_cents INT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- AUDIT
-- ==========================================================================

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES users(id),
    actor_ip INET,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id UUID,
    payload JSONB,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actor ON audit_log(actor_user_id, at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);

-- ==========================================================================
-- LEAD MAGNET (FREE SNAPSHOT)
-- ==========================================================================

CREATE TABLE demo_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email CITEXT NOT NULL,
    company TEXT,
    vendor_domain TEXT NOT NULL,
    answers JSONB NOT NULL,
    snapshot_score INT,
    converted_run_id UUID REFERENCES runs(id),
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_demo_leads_email ON demo_leads(email, created_at DESC);

-- ==========================================================================
-- VIEWS
-- ==========================================================================

CREATE OR REPLACE VIEW v_portfolio_summary AS
SELECT
    o.id AS org_id,
    o.legal_name,
    COUNT(DISTINCT v.id) AS vendor_count,
    COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'delivered') AS reports_delivered,
    COUNT(*) FILTER (WHERE r.hard_red_flag) AS red_flag_count,
    AVG(r.composite_score) FILTER (WHERE r.status = 'delivered') AS avg_score
FROM organizations o
LEFT JOIN vendors v ON v.organization_id = o.id
LEFT JOIN runs r ON r.organization_id = o.id
GROUP BY o.id, o.legal_name;
