-- 002_push_devices.sql
--
-- APNs / FCM push-notification device registration.
--
-- Rationale: iOS Build 9 (post-Apple 2.1(a)+4.2 rejection recovery) ships a
-- native push-notification surface. The iOS client calls
--   POST /v1/push/register { device_token, platform: 'ios' }
-- on every cold-start once the user has granted notification permission.
-- The API then fires "assessment ready" notifications when a run is delivered.
--
-- One row per (user, device_token). A user can have multiple devices
-- (iPhone + iPad). A device token can change (iOS reassigns after reinstall,
-- iCloud restore, etc.) — we upsert on (user_id, device_token).

CREATE TABLE IF NOT EXISTS push_devices (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token  TEXT NOT NULL,
    platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_token)
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);
