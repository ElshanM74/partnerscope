/**
 * POST /v1/newsletter/subscribe  (public)
 *
 * Adds an email subscriber to the «Before the Pitch» Resend Audience
 * (Persona A — AI Strategy + EU AI Act + DACH). No local DB write — Resend
 * Audience is single source of truth.
 *
 * Distinct from /v1/intake (PartnerScope SaaS scope requests). This endpoint
 * powers the partnerscope.eu/newsletter subscribe form.
 *
 * Unsubscribe is handled natively by Resend (List-Unsubscribe header
 * injected on every Broadcast send + Resend hosted unsubscribe page).
 *
 * If RESEND_NEWSLETTER_AUDIENCE_ID is not set, the endpoint logs the
 * subscriber and returns 202 without hitting Resend — useful for dev.
 */

import type { FastifyInstance } from 'fastify';
import { Resend } from 'resend';
import { z } from 'zod';

import { env } from '../config/env.js';

const SubscribeSchema = z.object({
  email: z.string().email().max(254),
  // Name is optional — many newsletter signups don't ask. We accept it
  // if provided (helps personalization in the publish CLI later).
  firstName: z.string().min(1).max(80).optional(),
  // Locale hint for future EN/RU segmentation. Defaults to 'en'.
  locale: z.enum(['en', 'ru']).default('en'),
  // UTM tracking — same shape as /v1/intake.
  utm: z
    .object({
      source: z.string().max(100).optional(),
      medium: z.string().max(100).optional(),
      campaign: z.string().max(100).optional(),
    })
    .optional(),
});

export async function newsletterRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/newsletter/subscribe', { config: { public: true } }, async (req, reply) => {
    const body = SubscribeSchema.parse(req.body);

    if (!env.RESEND_NEWSLETTER_AUDIENCE_ID) {
      // Dev mode — no Resend audience configured. Log and accept.
      req.log.warn(
        { email: body.email, locale: body.locale },
        'newsletter subscribe: RESEND_NEWSLETTER_AUDIENCE_ID not set — dry-run only',
      );
      reply.code(202).send({ subscribed: true, dryRun: true });
      return;
    }

    // Audiences API requires Full-access permission. The main RESEND_API_KEY
    // is Sending-only (smaller blast radius for transactional sends), so we
    // use a dedicated newsletter key. If not provided in dev, dry-run.
    const newsletterKey = env.RESEND_NEWSLETTER_API_KEY ?? env.RESEND_API_KEY;
    if (!newsletterKey) {
      req.log.error(
        'newsletter subscribe: neither RESEND_NEWSLETTER_API_KEY nor RESEND_API_KEY set',
      );
      reply.code(503).send({ error: 'newsletter temporarily unavailable' });
      return;
    }

    const resend = new Resend(newsletterKey);

    try {
      const result = await resend.contacts.create({
        email: body.email,
        firstName: body.firstName,
        unsubscribed: false,
        audienceId: env.RESEND_NEWSLETTER_AUDIENCE_ID,
      });

      if (result.error) {
        // Treat duplicate-subscriber as idempotent success. Resend's SDK
        // typing doesn't expose an "already_exists" error name in its enum,
        // so we string-match the message (the SDK exposes message reliably).
        const isAlreadyExists = /already exists|already subscribed/i.test(
          result.error.message ?? '',
        );

        if (isAlreadyExists) {
          req.log.info({ email: body.email }, 'newsletter subscribe: idempotent (already exists)');
          reply.code(200).send({ subscribed: true, already: true });
          return;
        }

        req.log.error(
          { err: result.error, email: body.email },
          'newsletter subscribe: Resend contacts.create failed',
        );
        reply.code(502).send({ error: 'subscribe failed' });
        return;
      }

      req.log.info(
        { email: body.email, contactId: result.data?.id, locale: body.locale, utm: body.utm },
        'newsletter subscribe: contact added',
      );
      reply.code(201).send({ subscribed: true, contactId: result.data?.id });
    } catch (err) {
      req.log.error({ err, email: body.email }, 'newsletter subscribe: unexpected error');
      reply.code(500).send({ error: 'internal error' });
    }
  });
}
