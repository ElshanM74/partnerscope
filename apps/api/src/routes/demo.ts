/**
 * POST /v1/demo/submit  (public)
 *   Free Snapshot lead magnet. Accepts 5-question answer set for
 *   D11/D12/D13, computes a preview score, stores a lead row.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { calculateScoring, likertToScore, questionsForTier } from '@partnerscope/core';

import { db } from '../db/client.js';
import { demoLeads } from '../db/schema.js';

const DemoAnswerSchema = z.object({
  questionId: z.string().min(1),
  likert: z.number().int().min(1).max(5),
});

const DemoSubmitSchema = z.object({
  email: z.string().email(),
  company: z.string().min(1).max(200).optional(),
  vendorDomain: z.string().min(3).max(253),
  answers: z.array(DemoAnswerSchema).min(1).max(10),
  utm: z
    .object({
      source: z.string().optional(),
      medium: z.string().optional(),
      campaign: z.string().optional(),
    })
    .optional(),
});

export async function demoRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/demo/submit', { config: { public: true } }, async (req, reply) => {
    const body = DemoSubmitSchema.parse(req.body);

    // Validate every provided questionId is actually gated for Free Snapshot.
    const allowed = new Set(questionsForTier('free_snapshot').map((q) => q.id));
    const bad = body.answers.filter((a) => !allowed.has(a.questionId));
    if (bad.length > 0) {
      reply.code(422).send({
        error: 'invalid_questions',
        message: 'One or more questionIds are not valid for free_snapshot tier.',
        invalid: bad.map((b) => b.questionId),
      });
      return;
    }

    const responses = body.answers.map((a) => {
      const v = a.likert as 1 | 2 | 3 | 4 | 5;
      return {
        questionId: a.questionId,
        rawAnswer: { type: 'likert' as const, value: v },
        numericScore: likertToScore(v),
      };
    });

    const result = calculateScoring({
      tier: 'free_snapshot',
      responses,
    });

    const [lead] = await db
      .insert(demoLeads)
      .values({
        email: body.email,
        company: body.company ?? null,
        vendorDomain: body.vendorDomain,
        answers: body.answers,
        snapshotScore: result.compositeScore,
        riskBand: result.riskBand,
        utmSource: body.utm?.source ?? null,
        utmMedium: body.utm?.medium ?? null,
        utmCampaign: body.utm?.campaign ?? null,
      })
      .returning({ id: demoLeads.id });

    reply.code(201).send({
      leadId: lead?.id,
      compositeScore: result.compositeScore,
      riskBand: result.riskBand,
      capReason: result.capReason,
      dimensionScores: result.dimensionScores.map((d) => ({
        dimensionCode: d.dimensionCode,
        score: d.score,
        band: d.band,
      })),
      upsell: {
        message:
          result.compositeScore < 66
            ? 'Your snapshot suggests significant risk. Run a full Starter assessment (€99) for a complete 13-dimension audit.'
            : 'Your snapshot is clean. Upgrade to Starter (€99) for a signed 13-dimension report.',
        starterUrl: 'https://partnerscope.eu/plans',
      },
    });
  });
}
