import type { FastifyInstance } from 'fastify';
import { pool } from '../../db/client.js';
import { prepareAssessment } from '../fulfillment.js';

/** Persisted queue survives process restarts; claim inside prepareAssessment is atomic. */
export function registerAssessmentWorker(app: FastifyInstance) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<void> | undefined;
  let stopped = false;
  async function tick() {
    await pool.query(
      "UPDATE runs SET status='failed', report_json=COALESCE(report_json,'{}'::jsonb)||'{\"fulfillmentError\":\"worker_interrupted\"}'::jsonb,updated_at=now() WHERE status='running' AND updated_at < now()-interval '10 minutes' AND (report_json->>'staffRequested'='true' OR EXISTS(SELECT 1 FROM billing_orders b WHERE b.run_id=runs.id))",
    );
    const queue = await pool.query(
      "SELECT r.id FROM runs r WHERE r.status='queued' AND (r.report_json->>'staffRequested'='true' OR EXISTS(SELECT 1 FROM billing_orders b WHERE b.run_id=r.id AND b.status='paid' AND (b.tier<>'enterprise' OR b.paid_until>now()))) ORDER BY r.created_at LIMIT 1",
    );
    if (queue.rows[0]) {
      const result = await prepareAssessment(queue.rows[0].id);
      app.log.info({ runId: queue.rows[0].id, ...result }, 'Assessment preparation finished');
    }
  }
  const schedule = () => {
    if (stopped || active) return;
    active = tick()
      .catch((err) => app.log.error({ err }, 'Assessment worker failed'))
      .finally(() => {
        active = undefined;
      });
  };
  app.addHook('onReady', async () => {
    timer = setInterval(schedule, 5000);
    timer.unref();
    schedule();
  });
  return async () => {
    stopped = true;
    if (timer) clearInterval(timer);
    await active;
  };
}
