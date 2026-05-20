-- ──────────────────────────────────────────────────────────────────
-- PartnerScope — intake submissions + drip campaign state
--
-- Persists every POST /v1/intake submission so the drip worker can
-- send timed follow-ups (Tx06/Tx07/Tx08) and link conversions back
-- to original lead source.
--
-- Drip cadence differs by tier:
--   - free_assessment   → Tx06a (Day 3) + Tx07a (Day 7)
--   - pilot_application → Tx06b (Day 1) + Tx07b (Day 5) + Tx08b (Day 14)
--   - starter/pro/enterprise → no drip (handled by paid onboarding)
--
-- Lifecycle guards:
--   - unsubscribed_at: user clicked unsubscribe link → halt all sends
--   - drip_disabled_at: manual halt (e.g. lead converted, replied,
--     or tier offering retired) → halt without user action
--   - tx*_sent_at non-null → idempotency (worker never double-sends)
-- ──────────────────────────────────────────────────────────────────

BEGIN;

DO $$ BEGIN
  CREATE TYPE intake_tier AS ENUM (
    'starter',
    'pro',
    'enterprise',
    'free_assessment',
    'pilot_application'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS intake_submissions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier                 intake_tier NOT NULL,
  email                CITEXT NOT NULL,
  buyer_name           TEXT NOT NULL,
  buyer_company        TEXT NOT NULL,
  vendor_domain        TEXT NOT NULL,
  vendor_legal_name    TEXT,
  notes                TEXT,
  -- UTM tracking (matches intake.ts schema)
  utm_source           TEXT,
  utm_medium           TEXT,
  utm_campaign         TEXT,
  -- Submission timestamp (also tx05_ack send time, since it's synchronous)
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  tx05_sent_at         TIMESTAMPTZ,
  -- Assessment drip (Day 3 + Day 7)
  tx06a_scheduled_at   TIMESTAMPTZ,
  tx06a_sent_at        TIMESTAMPTZ,
  tx07a_scheduled_at   TIMESTAMPTZ,
  tx07a_sent_at        TIMESTAMPTZ,
  -- Pilot drip (Day 1 + Day 5 + Day 14)
  tx06b_scheduled_at   TIMESTAMPTZ,
  tx06b_sent_at        TIMESTAMPTZ,
  tx07b_scheduled_at   TIMESTAMPTZ,
  tx07b_sent_at        TIMESTAMPTZ,
  tx08b_scheduled_at   TIMESTAMPTZ,
  tx08b_sent_at        TIMESTAMPTZ,
  -- Opt-out (user-initiated, via Tx06/07/08 unsubscribe link)
  unsubscribe_token    TEXT NOT NULL UNIQUE,
  unsubscribed_at      TIMESTAMPTZ,
  -- Manual halt (admin-initiated, e.g. lead converted or replied)
  drip_disabled_at     TIMESTAMPTZ,
  drip_disabled_reason TEXT,
  -- Conversion linkage (set when this lead becomes a paid run)
  converted_run_id     UUID REFERENCES runs(id) ON DELETE SET NULL,
  -- Audit
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookups for "all submissions by this email" (dedup, sales context)
CREATE INDEX IF NOT EXISTS idx_intake_submissions_email
  ON intake_submissions(email);

-- Lookups for funnel analysis ("all pilots last 30 days, newest first")
CREATE INDEX IF NOT EXISTS idx_intake_submissions_tier_submitted
  ON intake_submissions(tier, submitted_at DESC);

-- Unsubscribe endpoint hits this — unique already creates an index,
-- but explicit name aids EXPLAIN reading
CREATE INDEX IF NOT EXISTS idx_intake_submissions_unsubscribe_token
  ON intake_submissions(unsubscribe_token);

-- updated_at auto-bump on UPDATE (matches pattern from 001 if present;
-- safe to add even if no trigger function exists yet — wrapped in DO block)
DO $$ BEGIN
  CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $fn$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
EXCEPTION WHEN duplicate_function THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_intake_submissions_updated_at ON intake_submissions;
CREATE TRIGGER trg_intake_submissions_updated_at
  BEFORE UPDATE ON intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;
