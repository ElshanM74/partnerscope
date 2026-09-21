import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';
import { ApiError } from '../plugins/error-handler.js';
import type { AssessmentReport } from '../services/fulfillment.js';
import { buildReportId, renderEvidenceReportPdf } from '../services/pdf/index.js';
import { StorageKeys, getStorage } from '../services/storage.js';

const idSchema = z.object({ id: z.string().uuid() });
const reviewSchema = z.object({
  recommendation: z.string().trim().min(30).max(15000),
  conditions: z.string().trim().min(10).max(15000),
  confirmed: z.literal(true),
});
export async function fulfillmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.isStaff || !req.user?.sub)
      throw new ApiError(403, 'forbidden', 'Staff access required.');
    const active = await pool.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2', [
      req.user.sub,
      req.organization?.id,
    ]);
    if (!active.rowCount) throw new ApiError(401, 'unauthorized', 'Active staff account required.');
  });
  app.get('/v1/admin/assessments', async () => ({
    data: (
      await pool.query(
        'SELECT r.id,r.organization_id AS "organizationId",r.vendor_id AS "vendorId",v.legal_name AS "vendorName",r.tier,r.status,r.report_json AS "reportJson",r.created_at AS "createdAt",r.updated_at AS "updatedAt" FROM runs r JOIN vendors v ON v.id=r.vendor_id WHERE r.tier IN (\'starter\',\'pro\',\'enterprise\') AND (r.report_json->>\'source\' IS DISTINCT FROM \'questionnaire\') ORDER BY r.created_at DESC LIMIT 100',
      )
    ).rows,
  }));
  app.post('/v1/admin/assessments/:id/scope', async (req) => {
    const { id } = idSchema.parse(req.params);
    const body = z
      .object({
        contractReference: z.string().trim().min(5).max(200),
        scope: z.string().trim().min(30).max(12000),
        confirmed: z.literal(true),
      })
      .parse(req.body);
    const approval = {
      enterpriseScopeApproved: true,
      scopeApproval: {
        staffUserId: req.user?.sub,
        contractReference: body.contractReference,
        scope: body.scope,
        approvedAt: new Date().toISOString(),
      },
    };
    const r = await pool.query(
      `UPDATE runs SET report_json=COALESCE(report_json,'{}'::jsonb)||$2::jsonb,updated_at=now() WHERE id=$1 AND tier='enterprise' AND status='draft' RETURNING id,status,report_json AS "reportJson"`,
      [id, JSON.stringify(approval)],
    );
    if (!r.rowCount) throw new ApiError(409, 'not_scopeable', 'Enterprise draft required.');
    return r.rows[0];
  });
  app.post('/v1/admin/assessments/:id/retry', async (req) => {
    const { id } = idSchema.parse(req.params);
    const r = await pool.query(
      "UPDATE runs SET status='queued',report_json=COALESCE(report_json,'{}'::jsonb)||'{\"staffRequested\":true}'::jsonb,updated_at=now() WHERE id=$1 AND status IN ('draft','failed','queued') AND tier IN ('starter','pro','enterprise') RETURNING id,status",
      [id],
    );
    if (!r.rowCount)
      throw new ApiError(
        409,
        'not_retryable',
        'Only draft, failed or queued assessments can be prepared.',
      );
    return r.rows[0];
  });
  app.get('/v1/admin/assessments/:id/report.pdf', async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const r = await pool.query('SELECT report_json FROM runs WHERE id=$1', [id]);
    if (!r.rowCount) throw new ApiError(404, 'not_found', 'Assessment not found.');
    const candidate = r.rows[0].report_json?.pdfKey;
    const key =
      typeof candidate === 'string' &&
      candidate.startsWith(`runs/${id}/`) &&
      /^runs\/[a-f0-9-]+\/(?:review|attempt)-[a-f0-9-]+\.pdf$/.test(candidate)
        ? candidate
        : StorageKeys.runReportPdf(id);
    const storage = getStorage();
    if (!(await storage.exists(key))) throw new ApiError(404, 'report_not_ready', 'PDF not ready.');
    const result = await storage.stream(key);
    return reply
      .type('application/pdf')
      .header('content-disposition', `attachment; filename="partnerscope-${id}.pdf"`)
      .send(result.stream);
  });
  app.post('/v1/admin/assessments/:id/review', async (req) => {
    const { id } = idSchema.parse(req.params);
    const body = reviewSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        'SELECT r.*,v.legal_name AS "vendorName",v.domain,v.country FROM runs r JOIN vendors v ON v.id=r.vendor_id AND v.organization_id=r.organization_id WHERE r.id=$1 FOR UPDATE OF r',
        [id],
      );
      const run = r.rows[0];
      if (!run) throw new ApiError(404, 'not_found', 'Assessment not found.');
      if (run.status !== 'analyst_review' || run.report_json?.source !== 'assessment')
        throw new ApiError(
          409,
          'not_reviewable',
          'A prepared assessment awaiting analyst review is required.',
        );
      const analyst = (
        await client.query('SELECT full_name,email FROM users WHERE id=$1 FOR KEY SHARE', [
          req.user?.sub,
        ])
      ).rows[0];
      if (!analyst) throw new ApiError(401, 'unauthorized', 'Active reviewer required.');
      const report = run.report_json as AssessmentReport;
      const review = {
        analystName: analyst.full_name || analyst.email,
        recommendation: body.recommendation,
        conditions: body.conditions,
        reviewedAt: new Date().toISOString(),
      };
      const updated = {
        ...report,
        scope: report.scope.replace(
          'Draft pending named analyst review.',
          'Named analyst review completed.',
        ),
        limitations: report.limitations.filter((s) => !s.includes('awaiting analyst review')),
        review,
        reviewerId: req.user?.sub,
        pdfKey: `runs/${id}/review-${randomUUID()}.pdf`,
      };
      const pdf = await renderEvidenceReportPdf({
        reportId: buildReportId(run.tier, id, new Date().getUTCFullYear()),
        vendor: { legalName: run.vendorName, domain: run.domain, country: run.country },
        ...updated,
      });
      await getStorage().put(updated.pdfKey, pdf, 'application/pdf');
      await client.query(
        "UPDATE runs SET report_json=$2::jsonb,status='delivered',delivered_at=now(),updated_at=now(),report_pdf_url=$3 WHERE id=$1",
        [id, JSON.stringify(updated), `${env.API_BASE_URL}/v1/runs/${id}/report.pdf`],
      );
      await client.query('COMMIT');
      return { id, status: 'delivered', review };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
