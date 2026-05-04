-- ──────────────────────────────────────────────────────────────────
-- PartnerScope — password reset tokens
--
-- Backs the forgot-password flow: /v1/auth/forgot-password issues a row,
-- /v1/auth/reset-password consumes it. The raw token is never stored —
-- we keep a sha256 of the URL-safe random token in `token_hash`.
--
-- TTL is enforced by the handler via `expires_at`. Consumption is marked
-- by `used_at`; a row is "spent" once used_at is non-null.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
  ON password_reset_tokens(expires_at);

COMMIT;
