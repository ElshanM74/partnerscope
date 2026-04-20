/**
 * POST /v1/checkout/session
 *   Creates a Stripe Checkout session for the caller's org and returns
 *   { url }. The buyer is redirected to `url`; payment triggers
 *   /webhooks/stripe which in turn creates/advances the run.
 */

import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { vendors } from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';
import { createCheckoutSession } from '../services/stripe/index.js';

const CheckoutCreateSchema = z.object({
  tier: z.enum(['starter', 'pro', 'enterprise']),
  vendorId: z.string().uuid(),
  buyerEmail: z.string().email(),
  runId: z.string().uuid().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export async function checkoutRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/checkout/session', async (req) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const body = CheckoutCreateSchema.parse(req.body);

    // Confirm the vendor belongs to this org — otherwise webhook could be
    // tricked into paying for someone else's vendor.
    const [vendor] = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, body.vendorId), eq(vendors.organizationId, req.organization.id)))
      .limit(1);
    if (!vendor)
      throw new ApiError(404, 'vendor_not_found', 'Vendor not found for this organization.');

    const session = await createCheckoutSession({
      tier: body.tier,
      organizationId: req.organization.id,
      vendorId: body.vendorId,
      buyerEmail: body.buyerEmail,
      runId: body.runId,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });

    if (!session.url) {
      throw new ApiError(502, 'stripe_session_failed', 'Stripe did not return a checkout URL.');
    }

    return { id: session.id, url: session.url };
  });
}
