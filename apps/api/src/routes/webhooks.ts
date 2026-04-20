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

import { eq } from 'drizzle-orm';

import { getEntitlements } from '@partnerscope/core';
import type Stripe from 'stripe';
import { db } from '../db/client.js';
import { runs, vendors } from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';

import { parseCheckoutCompleted, verifyWebhookSignature } from '../services/stripe/index.js';

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
      throw new ApiError(400, 'invalid_signature', `Signature verification failed: ${msg}`);
    }

    // Only act on events we understand.
    const payload = parseCheckoutCompleted(event);
    if (payload) {
      // Vendor must still belong to the org (defence-in-depth).
      const [vendor] = await db
        .select({ id: vendors.id, organizationId: vendors.organizationId })
        .from(vendors)
        .where(eq(vendors.id, payload.vendorId))
        .limit(1);

      if (!vendor || vendor.organizationId !== payload.organizationId) {
        req.log.warn(
          {
            vendorId: payload.vendorId,
            orgId: payload.organizationId,
            sessionId: payload.stripeSessionId,
          },
          'Stripe webhook: vendor/org mismatch — ignoring',
        );
        return reply.code(200).send({ received: true, acted: false });
      }

      const entitlements = getEntitlements(payload.tier);
      const baseUpdate = {
        stripePaymentIntent: payload.stripePaymentIntent,
        slaHours: entitlements.slaHours,
        status: 'queued' as const,
        startedAt: new Date(),
        updatedAt: new Date(),
      };

      if (payload.runId) {
        await db.update(runs).set(baseUpdate).where(eq(runs.id, payload.runId));
      } else {
        // No run was pre-created — spawn one now so the buyer sees
        // something in their dashboard immediately.
        await db.insert(runs).values({
          vendorId: payload.vendorId,
          organizationId: payload.organizationId,
          tier: payload.tier,
          ...baseUpdate,
        });
      }
    }

    return reply.code(200).send({ received: true, acted: Boolean(payload) });
  });
}
