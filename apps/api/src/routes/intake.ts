/**
 * POST /v1/intake  (public)
 *
 * Scope-request handoff from the marketing site:
 *   - /get-started  — paid tiers (starter / pro / enterprise)
 *   - /assessment   — Free Partner Stack Assessment (free_assessment)
 *   - /pilot        — Pilot Program 2026 application (pilot_application)
 *
 * On submission:
 *   1. Persist row to intake_submissions (incl. unsubscribe_token).
 *   2. Send internal notice (to hello@partnerscope.eu) + Tx05 auto-ack to buyer.
 *   3. Schedule drip jobs (BullMQ) based on tier:
 *        free_assessment   → Tx06a (Day 3) + Tx07a (Day 7)
 *        pilot_application → Tx06b (Day 1) + Tx07b (Day 5) + Tx08b (Day 14)
 *        starter/pro/enterprise → no drip (post-payment onboarding is separate)
 *
 * Stripe handoff for paid tiers remains manual (human confirms scope and
 * issues payment link in response to the internal notice).
 */

import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { intakeSubmissions } from '../db/schema.js';
import { sendInternalIntakeNotice, sendTx05IntakeAck } from '../services/email/index.js';
import { DRIP_DELAYS, addDripJob } from '../services/queue/index.js';

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

function generateUnsubscribeToken(): string {
  // 32 bytes → 43-char base64url string. Cryptographically random + URL-safe.
  return randomBytes(32).toString('base64url');
}

export async function intakeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/intake', { config: { public: true } }, async (req, reply) => {
    const body = IntakeSchema.parse(req.body);
    const submittedAt = new Date();
    const unsubscribeToken = generateUnsubscribeToken();

    // ── Persist submission ────────────────────────────────────────
    // Insert before sending emails so we always have a record even if Resend
    // is degraded. If insert itself fails, return 500 — we want to know.
    const insertedRows = await db
      .insert(intakeSubmissions)
      .values({
        tier: body.tier,
        email: body.email,
        buyerName: body.buyerName,
        buyerCompany: body.buyerCompany,
        vendorDomain: body.vendorDomain,
        vendorLegalName: body.vendorLegalName,
        notes: body.notes,
        utmSource: body.utm?.source,
        utmMedium: body.utm?.medium,
        utmCampaign: body.utm?.campaign,
        submittedAt,
        unsubscribeToken,
      })
      .returning({ id: intakeSubmissions.id });

    const inserted = insertedRows[0];
    if (!inserted) {
      // INSERT … RETURNING never yields zero rows on success; this is a hard
      // postgres-driver invariant violation if reached.
      throw new Error('intake INSERT returned no rows');
    }
    const submissionId = inserted.id;

    // ── Fire internal notice + buyer auto-ack (Tx05) in parallel ──
    // Either can fail without blocking the submission acknowledgement.
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
        submittedAt: submittedAt.toISOString(),
      }),
      sendTx05IntakeAck({
        to: body.email,
        buyerName: body.buyerName,
        buyerCompany: body.buyerCompany,
        tier: body.tier,
      }),
    ]);

    if (internalRes.status === 'rejected') {
      req.log.error({ err: internalRes.reason, submissionId }, 'internal intake notice failed');
    }
    if (ackRes.status === 'rejected') {
      req.log.error({ err: ackRes.reason, submissionId }, 'buyer intake ack failed');
    }

    // Mark tx05_sent_at only if the Tx05 ack actually delivered (or dry-ran).
    if (ackRes.status === 'fulfilled') {
      await db
        .update(intakeSubmissions)
        .set({ tx05SentAt: new Date() })
        .where(eq(intakeSubmissions.id, submissionId));
    }

    // ── Schedule drip jobs ────────────────────────────────────────
    // Failures here MUST NOT fail the submission — the row is already
    // persisted, so we can retry scheduling out-of-band.
    try {
      const now = Date.now();

      if (body.tier === 'free_assessment') {
        await addDripJob('drip-tx06a-day3', submissionId, DRIP_DELAYS.assessment.day3);
        await addDripJob('drip-tx07a-day7', submissionId, DRIP_DELAYS.assessment.day7);
        await db
          .update(intakeSubmissions)
          .set({
            tx06aScheduledAt: new Date(now + DRIP_DELAYS.assessment.day3),
            tx07aScheduledAt: new Date(now + DRIP_DELAYS.assessment.day7),
          })
          .where(eq(intakeSubmissions.id, submissionId));
      } else if (body.tier === 'pilot_application') {
        await addDripJob('drip-tx06b-day1', submissionId, DRIP_DELAYS.pilot.day1);
        await addDripJob('drip-tx07b-day5', submissionId, DRIP_DELAYS.pilot.day5);
        await addDripJob('drip-tx08b-day14', submissionId, DRIP_DELAYS.pilot.day14);
        await db
          .update(intakeSubmissions)
          .set({
            tx06bScheduledAt: new Date(now + DRIP_DELAYS.pilot.day1),
            tx07bScheduledAt: new Date(now + DRIP_DELAYS.pilot.day5),
            tx08bScheduledAt: new Date(now + DRIP_DELAYS.pilot.day14),
          })
          .where(eq(intakeSubmissions.id, submissionId));
      }
      // starter/pro/enterprise: no drip — paid onboarding is a separate workstream
    } catch (err) {
      req.log.error({ err, submissionId, tier: body.tier }, 'drip scheduling failed');
      // intentionally do NOT rethrow — the submission is persisted
    }

    if (internalRes.status === 'rejected' && ackRes.status === 'rejected') {
      // Both emails failed — log full payload for manual recovery, return soft 202.
      req.log.warn(
        {
          submissionId,
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
      reply.code(202).send({ received: true, submissionId, queuedForManualFollowup: true });
      return;
    }

    reply.code(201).send({
      received: true,
      submissionId,
      deliveryId: internalRes.status === 'fulfilled' ? internalRes.value.id : null,
      ackSent: ackRes.status === 'fulfilled' && ackRes.value.delivered,
      dryRun: internalRes.status === 'fulfilled' ? internalRes.value.dryRun : false,
    });
  });
}
