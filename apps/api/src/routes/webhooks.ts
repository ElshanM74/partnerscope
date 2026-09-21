/**
 * POST /webhooks/stripe
 *   Stripe webhook receiver. Verifies the signature header against the
 *   raw request body, then dispatches recognised events into the app.
 *
 * NOTE: public route — no Bearer auth. Signature *is* the auth.
 * The raw body is captured via a custom content-type parser so
 * `constructEvent` gets the exact bytes Stripe signed.
 */

import type { FastifyInstance } from 'fastify';

import type Stripe from 'stripe';
import { ApiError } from '../plugins/error-handler.js';
import { applyBillingEvent } from '../services/billing.js';
import { verifyWebhookSignature } from '../services/stripe/index.js';

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Capture the raw body on application/json for Stripe's signature check.
  // Scoped to this plugin so other JSON routes keep using Fastify's default
  // parser.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try {
      const buf = body as Buffer;
      const json = buf.length ? JSON.parse(buf.toString('utf8')) : {};
      // Smuggle the raw bytes onto the request so the route handler
      // can verify the Stripe signature.
      (_req as unknown as { rawBody?: Buffer }).rawBody = buf;
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  fastify.post('/webhooks/stripe', { config: { public: true } }, async (req, reply) => {
    const sig = req.headers['stripe-signature'];
    if (!sig || Array.isArray(sig)) {
      throw new ApiError(400, 'missing_signature', 'Missing Stripe-Signature header.');
    }
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw) {
      throw new ApiError(400, 'missing_body', 'Raw request body was not captured.');
    }

    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(raw, sig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'signature verification failed';
      req.log.warn({ err: msg }, 'Stripe signature verification failed');
      throw new ApiError(400, 'invalid_signature', 'Signature verification failed.');
    }

    const result = await applyBillingEvent(event);
    // Return only the acknowledgment; internal identifiers and rejection reasons stay in logs.
    req.log.info(
      { outcome: result.outcome, eventType: event.type },
      'Stripe billing event processed',
    );
    return reply.code(200).send({ received: true, acted: result.acted });
  });
}
