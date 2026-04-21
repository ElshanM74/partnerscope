/**
 * POST /v1/intake  (public)
 *
 * Scope-request handoff from the marketing site's /get-started page.
 * This is intentionally lean: no DB write, no Stripe coupling. We render
 * an internal email to hello@partnerscope.eu via the existing Resend
 * integration. A human confirms scope and issues the Stripe payment link.
 *
 * This keeps the conversion funnel unblocked while Stripe Price IDs are
 * still being configured externally.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../config/env.js';
import { sendInternalIntakeNotice } from '../services/email/index.js';

const IntakeSchema = z.object({
  tier: z.enum(['starter', 'pro', 'enterprise']),
  email: z.string().email().max(254),
  buyerName: z.string().min(1).max(120),
  buyerCompany: z.string().min(1).max(200),
  vendorDomain: z.string().min(3).max(253),
  vendorLegalName: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  utm: z
    .object({
      source: z.string().max(100).optional(),
      medium: z.string().max(100).optional(),
      campaign: z.string().max(100).optional(),
    })
    .optional(),
});

export async function intakeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/intake', { config: { public: true } }, async (req, reply) => {
    const body = IntakeSchema.parse(req.body);

    try {
      const result = await sendInternalIntakeNotice({
        to: env.RESEND_REPLY_TO, // hello@partnerscope.eu by default
        replyTo: body.email,
        tier: body.tier,
        email: body.email,
        buyerName: body.buyerName,
        buyerCompany: body.buyerCompany,
        vendorDomain: body.vendorDomain,
        vendorLegalName: body.vendorLegalName,
        notes: body.notes,
        utm: body.utm,
        submittedAt: new Date().toISOString(),
      });

      reply.code(201).send({
        received: true,
        deliveryId: result.id,
        dryRun: result.dryRun,
      });
    } catch (err) {
      req.log.error({ err }, 'intake email failed');
      // Still accept the submission — losing leads to SMTP outages is worse
      // than returning a soft success; the API logs the payload for recovery.
      req.log.warn(
        {
          intake: {
            tier: body.tier,
            email: body.email,
            vendorDomain: body.vendorDomain,
            buyerCompany: body.buyerCompany,
          },
        },
        'intake payload (email send failed — recover from logs)',
      );
      reply.code(202).send({ received: true, queuedForManualFollowup: true });
    }
  });
}
