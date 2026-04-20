/**
 * Run lifecycle endpoints.
 *
 *   POST   /v1/runs                      — create a run (DRAFT)
 *   GET    /v1/runs                      — list runs for the org
 *   GET    /v1/runs/:id                  — fetch one run + latest scoring snapshot
 *   POST   /v1/runs/:id/responses        — submit questionnaire responses (batch)
 *   POST   /v1/runs/:id/submit           — transition draft → queued, triggers scoring
 *   GET    /v1/runs/:id/report.pdf       — stream the generated PDF
 *
 * Scoring is computed inline for Starter/Free Snapshot in Wave 1. Pro &
 * Enterprise enqueue BullMQ jobs in a later wave.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  type Response,
  type Tier,
  calculateScoring,
  getEntitlements,
  likertToScore,
  questionsForTier,
} from '@partnerscope/core';

import { db } from '../db/client.js';
import { responses, runs, vendors } from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';

// ────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────

const TierSchema = z.enum(['free_snapshot', 'starter', 'pro', 'enterprise']);

const RunCreateSchema = z.object({
  vendorId: z.string().uuid(),
  tier: TierSchema,
});

const RawAnswerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('likert'), value: z.number().int().min(1).max(5) }),
  z.object({ type: z.literal('multi_select'), values: z.array(z.string()) }),
  z.object({ type: z.literal('single_select'), value: z.string() }),
  z.object({ type: z.literal('free_form'), text: z.string() }),
  z.object({ type: z.literal('document_upload'), documentId: z.string().uuid() }),
]);

const ResponseInputSchema = z.object({
  questionId: z.string().min(1),
  rawAnswer: RawAnswerSchema,
});

const BatchResponsesSchema = z.object({
  responses: z.array(ResponseInputSchema).min(1).max(200),
});

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

async function loadRunForOrg(runId: string, organizationId: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId)))
    .limit(1);
  if (!run) throw new ApiError(404, 'run_not_found', 'Run not found.');
  return run;
}

function responsesFromRawRows(
  rows: { questionId: string; rawAnswer: unknown; numericScore: number | null }[],
): Response[] {
  return rows.map((r) => ({
    questionId: r.questionId,
    rawAnswer: r.rawAnswer as Response['rawAnswer'],
    numericScore: r.numericScore,
  }));
}

// ────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────

export async function runRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/runs', async (req, reply) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const body = RunCreateSchema.parse(req.body);

    // Confirm vendor belongs to this org.
    const [vendor] = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, body.vendorId), eq(vendors.organizationId, req.organization.id)))
      .limit(1);
    if (!vendor)
      throw new ApiError(404, 'vendor_not_found', 'Vendor not found for this organization.');

    const entitlements = getEntitlements(body.tier);

    const [created] = await db
      .insert(runs)
      .values({
        vendorId: body.vendorId,
        organizationId: req.organization.id,
        tier: body.tier,
        status: 'draft',
        slaHours: entitlements.slaHours,
      })
      .returning();

    reply.code(201).send(created);
  });

  fastify.get('/v1/runs', async (req) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const rows = await db
      .select()
      .from(runs)
      .where(eq(runs.organizationId, req.organization.id))
      .orderBy(desc(runs.createdAt))
      .limit(100);
    return { data: rows };
  });

  fastify.get<{ Params: { id: string } }>('/v1/runs/:id', async (req) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const id = z.string().uuid().parse(req.params.id);
    const run = await loadRunForOrg(id, req.organization.id);
    return run;
  });

  fastify.post<{ Params: { id: string } }>('/v1/runs/:id/responses', async (req, reply) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const id = z.string().uuid().parse(req.params.id);
    const body = BatchResponsesSchema.parse(req.body);
    const run = await loadRunForOrg(id, req.organization.id);
    if (run.status !== 'draft') {
      throw new ApiError(
        409,
        'run_not_draft',
        `Cannot modify responses; run is in status ${run.status}.`,
      );
    }

    const allowed = new Set(questionsForTier(run.tier).map((q) => q.id));
    const bad = body.responses.filter((r) => !allowed.has(r.questionId));
    if (bad.length > 0) {
      throw new ApiError(
        422,
        'invalid_questions',
        'One or more questionIds are not valid for this tier.',
        { invalid: bad.map((b) => b.questionId) },
      );
    }

    const rowsToUpsert = body.responses.map((r) => ({
      runId: id,
      questionId: r.questionId,
      rawAnswer: r.rawAnswer,
      numericScore:
        r.rawAnswer.type === 'likert'
          ? likertToScore(r.rawAnswer.value as 1 | 2 | 3 | 4 | 5)
          : null,
    }));

    // Upsert each response (unique on run_id + question_id).
    await db.transaction(async (tx) => {
      for (const row of rowsToUpsert) {
        await tx
          .insert(responses)
          .values(row)
          .onConflictDoUpdate({
            target: [responses.runId, responses.questionId],
            set: {
              rawAnswer: row.rawAnswer,
              numericScore: row.numericScore,
              answeredAt: new Date(),
            },
          });
      }
    });

    reply.code(204).send();
  });

  fastify.post<{ Params: { id: string } }>('/v1/runs/:id/submit', async (req) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const id = z.string().uuid().parse(req.params.id);
    const run = await loadRunForOrg(id, req.organization.id);
    if (run.status !== 'draft') {
      throw new ApiError(
        409,
        'run_not_draft',
        `Run is not in draft state (current: ${run.status}).`,
      );
    }

    const rows = await db
      .select({
        questionId: responses.questionId,
        rawAnswer: responses.rawAnswer,
        numericScore: responses.numericScore,
      })
      .from(responses)
      .where(eq(responses.runId, id));

    if (rows.length === 0) {
      throw new ApiError(400, 'no_responses', 'Run has no responses — cannot submit.');
    }

    // Starter: compute inline. Pro/Enterprise: enqueue (TODO Wave 3+).
    if (run.tier === 'starter' || run.tier === 'free_snapshot') {
      const result = calculateScoring({
        tier: run.tier as Tier,
        responses: responsesFromRawRows(rows),
      });

      const [updated] = await db
        .update(runs)
        .set({
          status: 'delivered',
          compositeScore: result.compositeScore,
          riskBand: result.riskBand,
          hardRedFlag: result.hardRedFlag,
          capReason: result.capReason,
          scoringVersion: result.scoringVersion,
          frameworkVersion: result.frameworkVersion,
          reportJson: result,
          deliveredAt: new Date(),
        })
        .where(eq(runs.id, id))
        .returning();
      return updated;
    }

    // Pro / Enterprise: flip to queued; worker picks up later.
    const [updated] = await db
      .update(runs)
      .set({ status: 'queued', startedAt: new Date() })
      .where(eq(runs.id, id))
      .returning();
    return updated;
  });

  fastify.get<{ Params: { id: string } }>('/v1/runs/:id/report.pdf', async (req, reply) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const id = z.string().uuid().parse(req.params.id);
    const run = await loadRunForOrg(id, req.organization.id);
    if (!run.reportPdfUrl) {
      throw new ApiError(404, 'report_not_ready', 'Report PDF not yet generated.');
    }
    // Wave 1: return a signed URL instead of streaming bytes directly.
    reply.code(200).send({ url: run.reportPdfUrl });
  });
}
