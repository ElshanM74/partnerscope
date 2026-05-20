/**
 * BullMQ worker — drip-emails queue.
 *
 * Consumes jobs scheduled by intake.ts. For each job:
 *   1. Load the intake_submission row by id.
 *   2. Check lifecycle guards (unsubscribed_at, drip_disabled_at, idempotency).
 *   3. Dispatch to the appropriate Tx* sender.
 *   4. UPDATE the corresponding tx*_sent_at column.
 *
 * Errors throw → BullMQ retries with exponential backoff (3 attempts).
 * Skips (guard failures) log + complete the job successfully (no retry).
 */

import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { intakeSubmissions } from '../../db/schema.js';
import {
  sendTx06aAssessmentDay3,
  sendTx06bPilotDay1,
  sendTx07aAssessmentDay7,
  sendTx07bPilotDay5,
  sendTx08bPilotDay14,
  type SendResult,
} from '../email/index.js';

import { DRIP_QUEUE_NAME, redisConnection, type DripJobData, type DripJobType } from './index.js';

// ────────────────────────────────────────────────────────────────
// Handler registry — single source of truth for jobType → behaviour
// ────────────────────────────────────────────────────────────────

type Submission = typeof intakeSubmissions.$inferSelect;

interface DripHandler {
  /** Pre-flight: is this jobType applicable to this submission's tier? */
  appliesTo: (tier: Submission['tier']) => boolean;
  /** Idempotency column — if non-null, skip (already sent). */
  sentAtCol: PgColumn;
  /** Sender function. */
  send: (input: {
    to: string;
    buyerName: string;
    buyerCompany: string;
    vendorDomain: string;
    unsubscribeUrl: string;
  }) => Promise<SendResult>;
}

const HANDLERS: Record<DripJobType, DripHandler> = {
  'drip-tx06a-day3': {
    appliesTo: (t) => t === 'free_assessment',
    sentAtCol: intakeSubmissions.tx06aSentAt,
    send: sendTx06aAssessmentDay3,
  },
  'drip-tx07a-day7': {
    appliesTo: (t) => t === 'free_assessment',
    sentAtCol: intakeSubmissions.tx07aSentAt,
    send: sendTx07aAssessmentDay7,
  },
  'drip-tx06b-day1': {
    appliesTo: (t) => t === 'pilot_application',
    sentAtCol: intakeSubmissions.tx06bSentAt,
    send: sendTx06bPilotDay1,
  },
  'drip-tx07b-day5': {
    appliesTo: (t) => t === 'pilot_application',
    sentAtCol: intakeSubmissions.tx07bSentAt,
    send: sendTx07bPilotDay5,
  },
  'drip-tx08b-day14': {
    appliesTo: (t) => t === 'pilot_application',
    sentAtCol: intakeSubmissions.tx08bSentAt,
    send: sendTx08bPilotDay14,
  },
};

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function unsubscribeUrl(token: string): string {
  // api.partnerscope.eu in prod; localhost in dev. Both serve the
  // /v1/unsubscribe/:token endpoint (added in routes/unsubscribe.ts).
  return `${env.API_BASE_URL.replace(/\/$/, '')}/v1/unsubscribe/${token}`;
}

// ────────────────────────────────────────────────────────────────
// Processor
// ────────────────────────────────────────────────────────────────

async function processDripJob(
  job: Job<DripJobData, unknown, DripJobType>,
  logger: FastifyBaseLogger,
): Promise<{ status: 'sent' | 'skipped'; reason?: string }> {
  const { submissionId } = job.data;
  const jobType = job.name;
  const log = logger.child({ jobType, submissionId, jobId: job.id });

  const handler = HANDLERS[jobType];
  if (!handler) {
    throw new Error(`unknown jobType: ${jobType}`);
  }

  const [submission] = await db
    .select()
    .from(intakeSubmissions)
    .where(eq(intakeSubmissions.id, submissionId))
    .limit(1);

  if (!submission) {
    log.warn('submission not found — skipping');
    return { status: 'skipped', reason: 'not_found' };
  }

  // Tier mismatch — shouldn't happen if intake.ts schedules correctly,
  // but defensive: if /pilot job hits an /assessment submission, skip.
  if (!handler.appliesTo(submission.tier)) {
    log.warn({ tier: submission.tier }, 'tier mismatch — skipping');
    return { status: 'skipped', reason: 'tier_mismatch' };
  }

  if (submission.unsubscribedAt) {
    log.info('skip — unsubscribed');
    return { status: 'skipped', reason: 'unsubscribed' };
  }

  if (submission.dripDisabledAt) {
    log.info({ reason: submission.dripDisabledReason }, 'skip — drip_disabled');
    return { status: 'skipped', reason: 'drip_disabled' };
  }

  // Idempotency — check the relevant tx*_sent_at column on the loaded row.
  // We look up by column name (the PgColumn's runtime name property).
  const sentAtColName = handler.sentAtCol.name as keyof Submission;
  if (submission[sentAtColName]) {
    log.info({ col: sentAtColName }, 'skip — already sent');
    return { status: 'skipped', reason: 'already_sent' };
  }

  const result = await handler.send({
    to: submission.email,
    buyerName: submission.buyerName,
    buyerCompany: submission.buyerCompany,
    vendorDomain: submission.vendorDomain,
    unsubscribeUrl: unsubscribeUrl(submission.unsubscribeToken),
  });

  await db
    .update(intakeSubmissions)
    .set({ [sentAtColName]: new Date() })
    .where(eq(intakeSubmissions.id, submissionId));

  log.info(
    { resendId: result.id, dryRun: result.dryRun, delivered: result.delivered },
    'drip email sent',
  );

  return { status: 'sent' };
}

// ────────────────────────────────────────────────────────────────
// Worker lifecycle
// ────────────────────────────────────────────────────────────────

let _worker: Worker<DripJobData, unknown, DripJobType> | null = null;

export function startDripWorker(logger: FastifyBaseLogger): Worker<DripJobData, unknown, DripJobType> {
  if (_worker) return _worker;

  _worker = new Worker<DripJobData, unknown, DripJobType>(
    DRIP_QUEUE_NAME,
    (job) => processDripJob(job, logger),
    {
      connection: redisConnection(),
      concurrency: 5,
      // BullMQ will not crash the process on job errors; we attach listeners
      // below for visibility.
    },
  );

  _worker.on('completed', (job, result) => {
    logger.info(
      { jobId: job.id, jobType: job.name, result },
      'drip job completed',
    );
  });

  _worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, jobType: job?.name, attempts: job?.attemptsMade, err: err.message },
      'drip job failed',
    );
  });

  _worker.on('error', (err) => {
    logger.error({ err: err.message }, 'drip worker error');
  });

  logger.info({ queue: DRIP_QUEUE_NAME, concurrency: 5 }, 'drip worker started');
  return _worker;
}

export async function stopDripWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
