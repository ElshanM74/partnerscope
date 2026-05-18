/**
 * POST /v1/intake  (public)
 *
 * Scope-request handoff from the marketing site:
 *   - /get-started  — paid tiers (starter / pro / enterprise)
 *   - /assessment   — Free Partner Stack Assessment (free_assessment)
 *   - /pilot        — Pilot Program 2026 application (pilot_application)
 *
 * This is intentionally lean: no DB write, no Stripe coupling. We render
 * an internal email to hello@partnerscope.eu via the existing Resend
 * integration. A human confirms scope and (for paid tiers) issues the
 * Stripe payment link. Free flows are delivered manually within the
 * advertised SLA.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../config/env.js';
import { sendInternalIntakeNotice, sendTx05IntakeAck } from '../services/email/index.js';

const IntakeSchema = z.object({
  tier: z.enum(['starter', 'pro', 'enterprise', 'free_assessment', 'pilot_application']),
  email: z.string().email().max(254),
  buyerName: z.string().min(1).max(120),
  buyerCompany: z.string().min(1).max(200),
  vendorDomain: z.string().min(3).max(253),
  vendorLegalName: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
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

    // Fire internal notice + buyer auto-ack in parallel. Either can fail without
    // blocking the submission acknowledgement; logged for manual recovery.
    const [internalRes, ackRes] = await Promise.allSettled([
      sendInternalIntakeNotice({
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
      }),
      sendTx05IntakeAck({
        to: body.email,
        buyerName: body.buyerName,
        buyerCompany: body.buyerCompany,
        tier: body.tier,
      }),
    ]);

    if (internalRes.status === 'rejected') {
      req.log.error({ err: internalRes.reason }, 'internal intake notice failed');
    }
    if (ackRes.status === 'rejected') {
      req.log.error({ err: ackRes.reason }, 'buyer intake ack failed');
    }

    if (internalRes.status === 'rejected' && ackRes.status === 'rejected') {
      // Both emails failed — log full payload for manual recovery, return soft 202.
      req.log.warn(
        {
          intake: {
            tier: body.tier,
            email: body.email,
            vendorDomain: body.vendorDomain,
            buyerCompany: body.buyerCompany,
            notes: body.notes,
          },
        },
        'intake payload (BOTH emails failed — recover from logs)',
      );
      reply.code(202).send({ received: true, queuedForManualFollowup: true });
      return;
    }

    reply.code(201).send({
      received: true,
      deliveryId: internalRes.status === 'fulfilled' ? internalRes.value.id : null,
      ackSent: ackRes.status === 'fulfilled' && ackRes.value.delivered,
      dryRun: internalRes.status === 'fulfilled' ? internalRes.value.dryRun : false,
    });
  });
}
