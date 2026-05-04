/**
 * Push-notification service — APNs (iOS) over HTTP/2 token auth.
 *
 * Uses `node-apn` (package `apn`) with a .p8 Token Auth key — the modern
 * recommended approach from Apple. Certificate-based (.p12) auth is not
 * supported here.
 *
 * Design choices:
 *   • Lazy init: we only instantiate the APNs provider on first send. Dev
 *     environments without APNS_* env vars never hit this code path.
 *   • Graceful no-op: missing config logs a warning and returns
 *     { sent: 0, failed: 0, skipped: 'apns_not_configured' } — the caller
 *     doesn't need to care whether pushes actually went out.
 *   • Dead-token cleanup: APNs may tell us a device token is no longer
 *     valid (BadDeviceToken / Unregistered). We delete those rows so we
 *     don't keep retrying forever.
 */

import apn from 'apn';
import { and, eq, inArray } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { pushDevices } from '../db/schema.js';

type SendResult = {
  sent: number;
  failed: number;
  skipped?: 'apns_not_configured' | 'no_devices';
  removed?: number;
};

type PushPayload = {
  title: string;
  body: string;
  /** Arbitrary JSON that the iOS client can read from the `data` userInfo dict. */
  data?: Record<string, string | number | boolean>;
};

let provider: apn.Provider | null = null;
let providerStatus: 'uninit' | 'ok' | 'misconfigured' = 'uninit';

/** Returns a shared APNs provider, or null if env is missing. */
function getProvider(): apn.Provider | null {
  if (providerStatus === 'ok' && provider) return provider;
  if (providerStatus === 'misconfigured') return null;

  const { APNS_TEAM_ID, APNS_KEY_ID, APNS_P8_KEY, APNS_PRODUCTION } = env;
  if (!APNS_TEAM_ID || !APNS_KEY_ID || !APNS_P8_KEY) {
    providerStatus = 'misconfigured';
    return null;
  }

  try {
    // APNS_P8_KEY is base64 of the raw .p8 file contents. Decode to utf-8
    // so apn.Provider can parse the PEM directly from memory (no disk I/O).
    const p8 = Buffer.from(APNS_P8_KEY, 'base64').toString('utf-8');

    provider = new apn.Provider({
      token: {
        key: p8,
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID,
      },
      production: APNS_PRODUCTION === 'true',
    });
    providerStatus = 'ok';
    return provider;
  } catch (err) {
    // Bad env (e.g. corrupted base64). Log once and fail closed.
    console.error('[push] Failed to initialise APNs provider:', err);
    providerStatus = 'misconfigured';
    return null;
  }
}

/** Call once on graceful shutdown so node-apn drains its HTTP/2 pool. */
export async function closePushProvider(): Promise<void> {
  if (provider) {
    provider.shutdown();
    provider = null;
    providerStatus = 'uninit';
  }
}

/**
 * Send a push to every iOS device registered for this user.
 *
 * Never throws. Intentionally fire-and-forget at the route level — if APNs
 * is down we don't want to fail a run-completion request over it.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<SendResult> {
  const devices = await db
    .select({ id: pushDevices.id, token: pushDevices.deviceToken, platform: pushDevices.platform })
    .from(pushDevices)
    .where(eq(pushDevices.userId, userId));

  const iosTokens = devices.filter((d) => d.platform === 'ios').map((d) => d.token);
  if (iosTokens.length === 0) {
    return { sent: 0, failed: 0, skipped: 'no_devices' };
  }

  const prov = getProvider();
  if (!prov) {
    return { sent: 0, failed: 0, skipped: 'apns_not_configured' };
  }

  const note = new apn.Notification();
  note.topic = env.APNS_TOPIC;
  note.alert = { title: payload.title, body: payload.body };
  note.sound = 'default';
  note.badge = 1;
  note.contentAvailable = true;
  // Optional userInfo for the iOS client to read on tap.
  if (payload.data) {
    // apn.Notification.payload is the `aps` sibling dict (user data).
    note.payload = { ...payload.data };
  }
  // 10 = immediate delivery (alert). See Apple docs §Remote Notification Payload.
  // (apn@2 doesn't expose apns-push-type; it defaults to "alert" which is
  // what we want for a user-visible banner.)
  note.priority = 10;
  // Expire in 1 hour — stale "assessment ready" notifications aren't useful.
  note.expiry = Math.floor(Date.now() / 1000) + 3600;

  const result = await prov.send(note, iosTokens);

  // result.sent is an array of { device } entries; result.failed is an array
  // of { device, status, response: { reason } }. Harvest tokens we should
  // delete to avoid endlessly retrying.
  const deadReasons = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);
  const deadTokens: string[] = result.failed
    .filter((f) => {
      const reason = (f.response as { reason?: string } | undefined)?.reason;
      return reason ? deadReasons.has(reason) : false;
    })
    .map((f) => f.device);

  let removed = 0;
  if (deadTokens.length > 0) {
    const del = await db
      .delete(pushDevices)
      .where(and(eq(pushDevices.userId, userId), inArray(pushDevices.deviceToken, deadTokens)))
      .returning({ id: pushDevices.id });
    removed = del.length;
  }

  return {
    sent: result.sent.length,
    failed: result.failed.length,
    ...(removed > 0 ? { removed } : {}),
  };
}
