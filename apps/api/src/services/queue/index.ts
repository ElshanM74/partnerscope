/**
 * BullMQ — drip-emails queue.
 *
 * Schedules delayed Tx06/Tx07/Tx08 sends after a POST /v1/intake submission.
 * Worker (drip-worker.ts) consumes jobs, checks lifecycle guards (unsubscribed,
 * drip_disabled, already sent), and sends via the existing email service.
 *
 * Job naming convention:
 *   drip-tx06a-day3   - Assessment Day 3
 *   drip-tx07a-day7   - Assessment Day 7
 *   drip-tx06b-day1   - Pilot Day 1
 *   drip-tx07b-day5   - Pilot Day 5
 *   drip-tx08b-day14  - Pilot Day 14
 *
 * Payload (all job types): { submissionId: string }
 */

import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

import { env } from '../../config/env.js';

// ────────────────────────────────────────────────────────────────
// Connection
// ────────────────────────────────────────────────────────────────

// BullMQ requires `maxRetriesPerRequest: null` for blocking commands (BRPOPLPUSH).
// One shared connection per process — BullMQ creates its own duplicate for
// blocking/subscriber operations internally.
let _redis: Redis | null = null;
export function redisConnection(): Redis {
  if (_redis) return _redis;
  _redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return _redis;
}

// ────────────────────────────────────────────────────────────────
// Queue
// ────────────────────────────────────────────────────────────────

export const DRIP_QUEUE_NAME = 'drip-emails';

export type DripJobType =
  | 'drip-tx06a-day3'
  | 'drip-tx07a-day7'
  | 'drip-tx06b-day1'
  | 'drip-tx07b-day5'
  | 'drip-tx08b-day14';

export interface DripJobData {
  submissionId: string;
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 }, // 1min, 5min, 25min
  // Keep completed jobs for 7 days OR the last 1000 — whichever first.
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  // Keep failed jobs longer for postmortem.
  removeOnFail: { age: 14 * 24 * 3600 },
};

let _queue: Queue<DripJobData, unknown, DripJobType> | null = null;

export function dripQueue(): Queue<DripJobData, unknown, DripJobType> {
  if (_queue) return _queue;
  _queue = new Queue<DripJobData, unknown, DripJobType>(DRIP_QUEUE_NAME, {
    connection: redisConnection(),
    defaultJobOptions,
  });
  return _queue;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Schedule a drip email for a submission. `delayMs` is from NOW; BullMQ
 * stores the job in Redis until ready. The worker dequeues at delay expiry.
 *
 * @returns the job ID (used for tracing + cancellation if drip is disabled)
 */
export async function addDripJob(
  jobType: DripJobType,
  submissionId: string,
  delayMs: number,
): Promise<string | undefined> {
  const job = await dripQueue().add(
    jobType,
    { submissionId },
    {
      delay: delayMs,
      // Job ID includes submissionId + jobType — guarantees idempotency
      // (BullMQ rejects duplicate job IDs in the same queue). Re-scheduling
      // is therefore a no-op, which is what we want if intake.ts retries.
      jobId: `${jobType}:${submissionId}`,
    },
  );
  return job.id;
}

/**
 * Cancel all scheduled drip jobs for a submission. Called when drip is
 * manually disabled (lead converted, replied, tier retired).
 *
 * Note: this is best-effort. If a job is already in-flight (worker fetched
 * it), the worker's own guards (unsubscribed_at, drip_disabled_at checks)
 * will skip the send.
 */
export async function cancelDripJobs(submissionId: string): Promise<void> {
  const jobTypes: DripJobType[] = [
    'drip-tx06a-day3',
    'drip-tx07a-day7',
    'drip-tx06b-day1',
    'drip-tx07b-day5',
    'drip-tx08b-day14',
  ];
  const q = dripQueue();
  await Promise.all(
    jobTypes.map(async (t) => {
      const job = await q.getJob(`${t}:${submissionId}`);
      if (job && !(await job.isCompleted()) && !(await job.isFailed())) {
        await job.remove();
      }
    }),
  );
}

/**
 * Graceful shutdown — close queue + Redis connection.
 * Called from server.ts SIGTERM handler.
 */
export async function closeQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

// ────────────────────────────────────────────────────────────────
// Delay constants (centralized so worker tests can override)
// ────────────────────────────────────────────────────────────────

export const DAY_MS = 24 * 60 * 60 * 1000;

export const DRIP_DELAYS = {
  assessment: {
    day3: 3 * DAY_MS,
    day7: 7 * DAY_MS,
  },
  pilot: {
    day1: 1 * DAY_MS,
    day5: 5 * DAY_MS,
    day14: 14 * DAY_MS,
  },
} as const;
