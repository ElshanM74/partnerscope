/**
 * Liveness + readiness.
 */

import type { FastifyInstance } from 'fastify';

import { pool } from '../db/client.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/healthz', { config: { public: true } }, async () => ({
    status: 'ok',
    service: 'partnerscope-api',
    version: '0.1.0',
  }));

  fastify.get('/readyz', { config: { public: true } }, async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready' };
    } catch (err) {
      reply.code(503).send({ status: 'not_ready', error: (err as Error).message });
      return reply;
    }
  });
}
