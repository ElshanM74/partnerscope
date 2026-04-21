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
 * Starter + Free Snapshot are scored inline in Wave 2.A: scoring → PDF →
 * TX-02 email → storage persist → runs.reportPdfUrl. Pro & Enterprise still
 * enqueue and will be picked up by a BullMQ worker in a later wave.
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
import { type TestResult, runSuite } from '@partnerscope/tests';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { responses, runs, vendors } from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';
import { sendTx02ReportReady } from '../services/email/index.js';
import { buildReportId, renderStarterReportPdf } from '../services/pdf/index.js';
import { StorageKeys, getStorage } from '../services/storage.js';

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

const SubmitBodySchema = z
  .object({
    buyerEmail: z.string().email().optional(),
    buyerName: z.string().min(1).max(200).optional(),
  })
  .optional()
  .default({});

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

async function loadVendor(vendorId: string) {
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  if (!vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found.');
  return vendor;
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

function tierDisplayName(tier: Tier): string {
  switch (tier) {
    case 'free_snapshot':
      return 'Free Snapshot';
    case 'starter':
      return 'Starter';
    case 'pro':
      return 'Pro';
    case 'enterprise':
      return 'Enterprise';
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────────
// Starter delivery pipeline — scoring → PDF → storage → email.
// Pure side-effectful helper. Fails the request if any step fails.
// ────────────────────────────────────────────────────────────────

async function deliverStarterReport(args: {
  runId: string;
  tier: Tier;
  vendor: { legalName: string; domain: string; country: string | null };
  buyerEmail: string | null;
  buyerName: string | null;
  buyerCompany: string;
  scoringResponses: Response[];
  /** Injection point for tests. If omitted, the real `runSuite` is called. */
  runTestSuite?: typeof runSuite;
}): Promise<{
  reportPdfUrl: string;
  scoring: ReturnType<typeof calculateScoring>;
  tests: TestResult[];
  emailDelivered: boolean;
}> {
  const scoring = calculateScoring({ tier: args.tier, responses: args.scoringResponses });

  // Only Starter runs the automated test suite; Free Snapshot is questionnaire-only.
  const suite = args.runTestSuite ?? runSuite;
  const tests: TestResult[] =
    args.tier === 'starter'
      ? await suite({ tier: 'starter', domain: args.vendor.domain }).catch(() => [])
      : [];

  const now = new Date();
  const validUntil = new Date(now);
  validUntil.setUTCDate(validUntil.getUTCDate() + 90);

  const reportId = buildReportId(args.tier, args.runId, now.getUTCFullYear());

  const pdf = await renderStarterReportPdf({
    reportId,
    issueDate: formatDate(now),
    validUntil: formatDate(validUntil),
    tierName: tierDisplayName(args.tier),
    vendor: {
      legalName: args.vendor.legalName,
      domain: args.vendor.domain,
      country: args.vendor.country,
    },
    buyer: {
      name: args.buyerName,
      company: args.buyerCompany,
      email: args.buyerEmail,
    },
    scoring,
    tests: tests.map((t) => ({ id: t.id, status: t.status, finding: t.finding })),
    upgradeUrl: `${env.APP_PUBLIC_URL}/upgrade?from=${reportId}`,
  });

  const storage = getStorage();
  const stored = await storage.put(StorageKeys.runReportPdf(args.runId), pdf, 'application/pdf');
  const reportPdfUrl = storage.url(stored.key);

  let emailDelivered = false;
  if (args.buyerEmail) {
    const emailResult = await sendTx02ReportReady({
      to: args.buyerEmail,
      buyerName: args.buyerName ?? 'there',
      tierName: tierDisplayName(args.tier),
      vendorLegalName: args.vendor.legalName,
      compositeScore: scoring.compositeScore,
      riskBand: scoring.riskBand,
      hardRedFlag: scoring.hardRedFlag,
      reportPdfUrl,
      dashboardUrl: `${env.APP_PUBLIC_URL}/runs/${args.runId}`,
      validUntil: formatDate(validUntil),
    });
    emailDelivered = emailResult.delivered;
  }

  return { reportPdfUrl, scoring, tests, emailDelivered };
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
    const body = SubmitBodySchema.parse(req.body ?? {});
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

    // Starter / Free Snapshot: compute inline + generate PDF + send email.
    if (run.tier === 'starter' || run.tier === 'free_snapshot') {
      const vendor = await loadVendor(run.vendorId);
      const delivery = await deliverStarterReport({
        runId: id,
        tier: run.tier as Tier,
        vendor: {
          legalName: vendor.legalName,
          domain: vendor.domain,
          country: vendor.country,
        },
        buyerEmail: body.buyerEmail ?? null,
        buyerName: body.buyerName ?? null,
        buyerCompany: req.organization.legalName,
        scoringResponses: responsesFromRawRows(rows),
      });

      const [updated] = await db
        .update(runs)
        .set({
          status: 'delivered',
          compositeScore: delivery.scoring.compositeScore,
          riskBand: delivery.scoring.riskBand,
          hardRedFlag: delivery.scoring.hardRedFlag,
          capReason: delivery.scoring.capReason,
          scoringVersion: delivery.scoring.scoringVersion,
          frameworkVersion: delivery.scoring.frameworkVersion,
          reportJson: { scoring: delivery.scoring, tests: delivery.tests },
          reportPdfUrl: delivery.reportPdfUrl,
          deliveredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(runs.id, id))
        .returning();
      return {
        ...updated,
        emailDelivered: delivery.emailDelivered,
        testsRan: delivery.tests.length,
      };
    }

    // Pro / Enterprise: flip to queued; worker picks up later.
    const [updated] = await db
      .update(runs)
      .set({ status: 'queued', startedAt: new Date(), updatedAt: new Date() })
      .where(eq(runs.id, id))
      .returning();
    return updated;
  });

  fastify.get<{ Params: { id: string } }>('/v1/runs/:id/report.pdf', async (req, reply) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const id = z.string().uuid().parse(req.params.id);
    const run = await loadRunForOrg(id, req.organization.id);

    const storage = getStorage();
    const key = StorageKeys.runReportPdf(run.id);
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
