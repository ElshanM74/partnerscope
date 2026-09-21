import { getEntitlements, questionsForTier } from '@partnerscope/core';
/** Authenticated assessment orders, supplied responses, execution and PDF access. */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, pool } from '../db/client.js';
import { responses, runs, vendors } from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';
import { hasRunEntitlement } from '../services/billing.js';
import { validateQuestionnaire } from '../services/questionnaire.js';
import { StorageKeys, getStorage } from '../services/storage.js';

const TierSchema = z.enum(['free_snapshot', 'starter', 'pro', 'enterprise']);

const RunCreateSchema = z.object({
  vendorId: z.string().uuid(),
  tier: TierSchema,
  context: z
    .object({
      task: z.string().trim().min(10).max(2000),
      criteria: z.string().trim().min(3).max(1000),
      country: z.string().trim().min(2).max(100).optional(),
    })
    .optional(),
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

async function loadRunForOrg(runId: string, organizationId: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId)))
    .limit(1);
  if (!run) throw new ApiError(404, 'run_not_found', 'Run not found.');
  return run;
}

export async function runRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', async (req) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'Organization required.');
    if (req.user?.sub) {
      const active = await pool.query('SELECT role FROM users WHERE id=$1 AND organization_id=$2', [
        req.user.sub,
        req.organization.id,
      ]);
      if (!active.rowCount) throw new ApiError(401, 'unauthorized', 'Active membership required.');
      if (req.method !== 'GET' && active.rows[0].role === 'viewer')
        throw new ApiError(403, 'forbidden', 'Read-only account.');
    }
  });
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
        requestedBy: req.user?.sub,
        reportJson: body.context ? { context: body.context } : null,
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

    try {
      validateQuestionnaire({
        answers: body.responses.map((r) => {
          const answer = r.rawAnswer;
          if (!['likert', 'single_select', 'multi_select'].includes(answer.type))
            throw new Error('unsupported_response');
          return {
            questionId: r.questionId,
            value:
              answer.type === 'multi_select'
                ? answer.values
                : 'value' in answer
                  ? answer.value
                  : undefined,
          };
        }),
      });
    } catch {
      throw new ApiError(
        422,
        'invalid_response',
        'Use supported question types and valid options.',
      );
    }

    const rowsToUpsert = body.responses.map((r) => ({
      runId: id,
      questionId: r.questionId,
      rawAnswer: r.rawAnswer,
      numericScore: null,
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

    if (run.tier !== 'free_snapshot') {
      if (!req.isStaff && !(await hasRunEntitlement(id, req.organization.id)))
        throw new ApiError(402, 'payment_required', 'Payment for this assessment is required.');
      const [queued] = await db
        .update(runs)
        .set({
          status: 'queued',
          updatedAt: new Date(),
          reportJson: {
            ...((run.reportJson as Record<string, unknown>) ?? {}),
            ...(req.isStaff ? { staffRequested: true } : {}),
          },
        })
        .where(and(eq(runs.id, id), eq(runs.status, 'draft')))
        .returning();
      if (!queued)
        throw new ApiError(409, 'run_not_draft', 'Assessment has already been submitted.');
      return queued;
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

    const result = validateQuestionnaire({
      answers: rows.map((row) => {
        const answer = row.rawAnswer as {
          type?: string;
          value?: number | string;
          values?: string[];
          unknown?: boolean;
        };
        return answer.unknown
          ? { questionId: row.questionId, unknown: true }
          : {
              questionId: row.questionId,
              value: answer.type === 'multi_select' ? answer.values : answer.value,
            };
      }),
    });
    const [saved] = await db
      .update(runs)
      .set({
        status: 'delivered',
        reportJson: result.report,
        compositeScore: null,
        riskBand: null,
        hardRedFlag: false,
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(runs.id, id), eq(runs.status, 'draft')))
      .returning();
    if (!saved) throw new ApiError(409, 'run_not_draft', 'Assessment already submitted.');
    return saved;
  });

  fastify.get<{ Params: { id: string } }>('/v1/runs/:id/report.pdf', async (req, reply) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const id = z.string().uuid().parse(req.params.id);
    const run = await loadRunForOrg(id, req.organization.id);

    if (run.status !== 'delivered')
      throw new ApiError(409, 'report_not_ready', 'The final report is not yet delivered.');
    const storage = getStorage();
    const candidate = (run.reportJson as { pdfKey?: string } | null)?.pdfKey;
    const key =
      typeof candidate === 'string' &&
      candidate.startsWith(`runs/${run.id}/`) &&
      /^runs\/[a-f0-9-]+\/(?:review|attempt)-[a-f0-9-]+\.pdf$/.test(candidate)
        ? candidate
        : StorageKeys.runReportPdf(run.id);
    if (!(await storage.exists(key))) {
      throw new ApiError(404, 'report_not_ready', 'Report PDF not yet generated.');
    }

    const { stream, sizeBytes, contentType } = await storage.stream(key);
    reply
      .header('content-type', contentType)
      .header('content-length', sizeBytes)
      .header('content-disposition', `attachment; filename="partnerscope-${run.id}.pdf"`);
    return reply.send(stream);
  });
}
