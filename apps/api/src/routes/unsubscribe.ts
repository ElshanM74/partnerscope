/**
 * GET/POST /v1/unsubscribe/:token  (public)
 *
 * Marks an intake_submissions row as unsubscribed. Idempotent — repeated
 * hits return the same confirmation page.
 *
 * Two HTTP methods supported:
 *   - GET:  user clicks the unsubscribe link in a drip email
 *   - POST: Gmail/Apple Mail one-click unsubscribe (List-Unsubscribe-Post
 *           header set to `List-Unsubscribe=One-Click` in drip senders)
 *
 * Token is the URL-safe random secret from intake_submissions.unsubscribe_token,
 * generated at intake time (43-char base64url). Unknown tokens return 200 with
 * a generic confirmation page — we never leak whether a token is valid (avoids
 * subscriber-list enumeration).
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { db } from '../db/client.js';
import { intakeSubmissions } from '../db/schema.js';

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Unsubscribed — PartnerScope</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui,-apple-system,'Segoe UI',sans-serif; max-width: 560px; margin: 80px auto; padding: 0 24px; color: #1a2233; line-height: 1.55; }
  h1 { font-size: 1.5rem; margin: 0 0 16px; }
  p { margin: 0 0 16px; }
  .muted { color: #6b7488; font-size: 0.9em; }
  a { color: #4f7cff; }
</style>
</head>
<body>
  <h1>You've been unsubscribed.</h1>
  <p>You will receive no further follow-up emails from PartnerScope on this thread.</p>
  <p class="muted">Transactional emails (assessment reports, payment receipts) are not affected — those continue if you have an active request.</p>
  <p class="muted">If you change your mind or need to reach us: <a href="mailto:elshan.musayev@partnerscope.eu">elshan.musayev@partnerscope.eu</a></p>
  <hr style="border:none;border-top:1px solid #e3e6ec;margin:32px 0" />
  <p class="muted">PartnerScope · EKM Global Consulting GmbH · Baden-Baden, Germany · <a href="https://partnerscope.eu">partnerscope.eu</a></p>
</body>
</html>`;

async function handleUnsubscribe(token: string): Promise<void> {
  // UPDATE WHERE token = :token AND unsubscribed_at IS NULL.
  // Idempotent — re-hit on already-unsubscribed row touches no columns,
  // preserving the original unsubscribe timestamp.
  await db
    .update(intakeSubmissions)
    .set({ unsubscribedAt: new Date() })
    .where(
      and(eq(intakeSubmissions.unsubscribeToken, token), isNull(intakeSubmissions.unsubscribedAt)),
    );
}

export async function unsubscribeRoutes(fastify: FastifyInstance): Promise<void> {
  // GET — browser click from drip email
  fastify.get<{ Params: { token: string } }>(
    '/v1/unsubscribe/:token',
    { config: { public: true } },
    async (req, reply) => {
      const { token } = req.params;
      await handleUnsubscribe(token).catch((err) => {
        // Best-effort — never expose internal errors to user.
        req.log.error({ err, tokenPreview: token.slice(0, 8) }, 'unsubscribe update failed');
      });
      reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .code(200)
        .send(SUCCESS_HTML);
    },
  );

  // POST — RFC 8058 one-click unsubscribe (List-Unsubscribe-Post header).
  // Gmail/Apple Mail call this without user interaction; response body
  // doesn't matter (clients discard it) but must be 2xx.
  fastify.post<{ Params: { token: string } }>(
    '/v1/unsubscribe/:token',
    { config: { public: true } },
    async (req, reply) => {
      const { token } = req.params;
      await handleUnsubscribe(token).catch((err) => {
        req.log.error({ err, tokenPreview: token.slice(0, 8) }, 'unsubscribe POST failed');
      });
      reply.code(200).send({ unsubscribed: true });
    },
  );
}
