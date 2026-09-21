import { randomUUID } from 'node:crypto';
import { type TestResult, runSuite } from '@partnerscope/tests';
import pino from 'pino';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';
import { type EvidenceReportInput, buildReportId, renderEvidenceReportPdf } from './pdf/index.js';
import { ResearchInput, type ResearchResult, research } from './research/index.js';
import { getStorage } from './storage.js';

const log = pino({ level: env.LOG_LEVEL });

export interface AssessmentReport {
  source: 'assessment';
  attemptToken: string;
  pdfKey: string;
  scope: string;
  tests: TestResult[];
  research?: ResearchResult;
  limitations: string[];
  preparedAt: string;
  context: { task: string; criteria: string; country: string; defaulted: boolean };
  review?: EvidenceReportInput['review'];
  enterpriseScopeApproved?: true;
  scopeApproval?: EvidenceReportInput['scopeApproval'];
}

/** Idempotently claims queued work; callers schedule retries by requeueing failed runs. */
export async function prepareAssessment(
  runId: string,
): Promise<{ claimed: boolean; status?: 'delivered' | 'analyst_review' | 'failed' }> {
  z.string().uuid().parse(runId);
  const attemptToken = randomUUID();
  const claim = await pool.query(
    "UPDATE runs SET status='running',started_at=now(),updated_at=now(),report_json=COALESCE(report_json,'{}'::jsonb)||jsonb_build_object('attemptToken',$2::text) WHERE id=$1 AND status='queued' RETURNING id,vendor_id,organization_id,tier,report_json,updated_at::text AS claim_updated_at",
    [runId, attemptToken],
  );
  if (!claim.rowCount) return { claimed: false };
  const run = claim.rows[0];
  let stage = 'vendor';
  try {
    if (!['free_snapshot', 'starter', 'pro', 'enterprise'].includes(run.tier))
      throw new Error('unsupported_tier');
    const vendor = (
      await pool.query(
        'SELECT legal_name AS "legalName",domain,country FROM vendors WHERE id=$1 AND organization_id=$2',
        [run.vendor_id, run.organization_id],
      )
    ).rows[0];
    if (!vendor) throw new Error('vendor_not_found');
    // All tiers share the same four technical observations; no score calculation.
    stage = 'technical_checks';
    const tests = await runSuite({ tier: 'starter', domain: vendor.domain });
    if (tests.length !== 4) throw new Error('incomplete_technical_suite');
    stage = 'context';
    const supplied = z
      .object({
        task: z.string().trim().min(10).max(2000).optional(),
        criteria: z.string().trim().min(3).max(1000).optional(),
        country: z.string().trim().min(2).max(100).optional(),
      })
      .safeParse(run.report_json?.context ?? {});
    if (!supplied.success) throw new Error('invalid_assessment_context');
    const context = {
      task:
        supplied.data.task ??
        'Check the publicly documented business profile and supplier capabilities of this company. No specific procurement brief was supplied.',
      criteria:
        supplied.data.criteria ??
        'Identity matching, relevant publicly supported experience, information gaps and questions for qualification. Do not infer available staff or delivery capability.',
      country: supplied.data.country ?? vendor.country ?? 'Not specified',
      defaulted: !supplied.data.task || !supplied.data.criteria,
    };
    const isSnapshot = run.tier === 'starter' || run.tier === 'free_snapshot';
    const scope = isSnapshot
      ? 'External technical snapshot of the specified domain: DNS, TLS, HTTP headers and certificate transparency. No overall supplier risk assessment.'
      : 'Public-source supplier research and external technical snapshot. Draft pending named analyst review.';
    const limitations = [
      'Technical checks apply to the specified domain at the stated times, not all systems operated by the company.',
      'A check error indicates missing observations and is not a supplier failure.',
      'No composite score, legal clearance, available-team confirmation or prediction of delivery performance is provided.',
    ];
    if (context.defaulted && !isSnapshot)
      limitations.push(
        'No complete buyer brief was supplied. Research used the explicitly recorded general supplier-check context; suitability for a specific engagement remains undetermined.',
      );
    const report: AssessmentReport = {
      source: 'assessment',
      attemptToken,
      pdfKey: `runs/${runId}/attempt-${attemptToken}.pdf`,
      scope,
      tests,
      limitations,
      preparedAt: new Date().toISOString(),
      context,
    };
    if (run.tier === 'enterprise') {
      const approval = z
        .object({
          staffUserId: z.string().uuid(),
          contractReference: z.string().min(5).max(200),
          scope: z.string().min(30).max(12000),
          approvedAt: z.string().datetime(),
        })
        .safeParse(run.report_json?.scopeApproval);
      if (run.report_json?.enterpriseScopeApproved === true && approval.success) {
        report.enterpriseScopeApproved = true;
        report.scopeApproval = approval.data;
      }
      report.limitations.push(
        'This document covers this vendor only. It does not mark the wider Enterprise engagement or portfolio as completed. The analyst must reconcile this vendor report with the agreed contract scope.',
      );
    }
    if (!isSnapshot) {
      stage = 'research_provider';
      if (!env.OPENAI_API_KEY) throw new Error('research_not_configured');
      report.research = await research(
        ResearchInput.parse({
          mode: 'check',
          company: `${vendor.legalName} (${vendor.domain})`.slice(0, 200),
          country: context.country,
          task: context.task,
          criteria: context.criteria,
        }),
        env.OPENAI_API_KEY,
        env.RESEARCH_MODEL,
      );
      report.limitations.push(
        'Research is AI-assisted and awaiting analyst review; source references are not independent verification of every claim.',
      );
    }
    stage = 'pdf_renderer';
    const pdf = await renderEvidenceReportPdf({
      reportId: buildReportId(run.tier, runId, new Date(report.preparedAt).getUTCFullYear()),
      vendor,
      ...report,
    });
    stage = 'storage';
    const storage = getStorage();
    await storage.put(report.pdfKey, pdf, 'application/pdf');
    const status = isSnapshot ? 'delivered' : 'analyst_review';
    // Store an authenticated report route, not the unimplemented /storage URL.
    const reportPdfUrl = `${env.API_BASE_URL}/v1/runs/${runId}/report.pdf`;
    stage = 'database_finalize';
    const finalized = await pool.query(
      "UPDATE runs SET status=$2::run_status,report_json=$3::jsonb,report_pdf_url=$4,composite_score=NULL,risk_band=NULL,hard_red_flag=false,cap_reason=NULL,delivered_at=CASE WHEN $2::run_status='delivered' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND status='running' AND report_json->>'attemptToken'=$5 AND updated_at=$6::timestamptz RETURNING id",
      [runId, status, JSON.stringify(report), reportPdfUrl, attemptToken, run.claim_updated_at],
    );
    if (!finalized.rowCount) {
      log.warn(
        { runId, attemptToken, code: 'stale_attempt' },
        'Assessment attempt no longer owns the run',
      );
      return { claimed: true, status: 'failed' };
    }
    return { claimed: true, status };
  } catch (error) {
    const safeCodes = new Set([
      'unsupported_tier',
      'vendor_not_found',
      'incomplete_technical_suite',
      'invalid_assessment_context',
      'research_not_configured',
    ]);
    const code =
      error instanceof Error && safeCodes.has(error.message) ? error.message : `${stage}_failed`;
    // Never emit exception messages, provider payloads, URLs or credentials.
    log.warn({ runId, stage, code }, 'Assessment preparation failed');
    await pool.query(
      "UPDATE runs SET status='failed',report_json=COALESCE(report_json,'{}'::jsonb) || $2::jsonb,updated_at=now() WHERE id=$1 AND status='running' AND report_json->>'attemptToken'=$3 AND updated_at=$4::timestamptz",
      [
        runId,
        JSON.stringify({
          fulfillmentError: code,
          fulfillmentStage: stage,
          failedAt: new Date().toISOString(),
        }),
        attemptToken,
        run.claim_updated_at,
      ],
    );
    return { claimed: true, status: 'failed' };
  }
}
