BEGIN;
CREATE TABLE IF NOT EXISTS billing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  run_id UUID NOT NULL UNIQUE REFERENCES runs(id),
  tier tier_enum NOT NULL CHECK (tier IN ('starter','pro','enterprise')),
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('paid','inactive')),
  amount_total INTEGER NOT NULL CHECK (amount_total >= 0),
  currency TEXT NOT NULL,
  subscription_status TEXT,
  paid_until TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_orders_org_idx ON billing_orders(organization_id);
CREATE TABLE IF NOT EXISTS billing_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_refunds (
  stripe_payment_intent TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL REFERENCES billing_events(stripe_event_id),
  refunded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
