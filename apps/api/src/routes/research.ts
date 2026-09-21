import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';
import { ResearchInput, research } from '../services/research/index.js';
import { ResearchStore } from '../services/research/store.js';

export async function researchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.organization) return reply.code(401).send({ error: 'unauthorized' });
    const membership = req.user?.sub
      ? await pool.query('SELECT id FROM users WHERE id = $1 AND organization_id = $2', [
          req.user.sub,
          req.organization.id,
        ])
      : await pool.query('SELECT id FROM organizations WHERE id = $1', [req.organization.id]);
    if (!membership.rowCount) return reply.code(401).send({ error: 'unauthorized' });
  });
  const store = new ResearchStore(env.STORAGE_LOCAL_DIR);
  const active = new Set<string>();
  app.get('/v1/research', async (req, reply) => {
    if (!req.organization) return reply.code(401).send({ error: 'unauthorized' });
    return { reports: await store.list(req.organization.id) };
  });
  app.get('/v1/research/:id', async (req, reply) => {
    if (!req.organization) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_id' });
    const report = await store.get(req.organization.id, parsed.data.id);
    if (!report) return reply.code(404).send({ error: 'not_found' });
    return report;
  });
  app.post(
    '/v1/research',
    {
      config: {
        rateLimit: {
          hook: 'preHandler',
          max: 5,
          timeWindow: '1 hour',
          keyGenerator: (req) => req.organization?.id ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      if (!req.organization) return reply.code(401).send({ error: 'unauthorized' });
      const input = ResearchInput.safeParse(req.body);
      if (!input.success)
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Укажите страну, задачу, критерии и компанию для проверки.',
        });
      if (!env.OPENAI_API_KEY)
        return reply.code(503).send({
          error: 'research_unavailable',
          message: 'Поиск временно недоступен. Попробуйте позже.',
        });
      const org = req.organization.id;
      if (active.has(org) || active.size >= 4)
        return reply.code(429).send({
          error: 'research_busy',
          message: 'Поиск уже выполняется. Дождитесь результата.',
        });
      active.add(org);
      try {
        const result = await research(input.data, env.OPENAI_API_KEY, env.RESEARCH_MODEL);
        const report = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          request: input.data,
          ...result,
        };
        await store.save(org, report);
        return reply.code(201).send(report);
      } catch (error) {
        if (error instanceof Error && error.message === 'research_sources_missing') {
          return reply.code(422).send({
            error: 'insufficient_evidence',
            message:
              'Недостаточно источников для отчёта. Уточните название, сайт или регистрационный номер компании. Отсутствие сведений не означает ненадёжность компании.',
          });
        }
        req.log.warn(
          {
            code:
              error instanceof Error && /^research_[a-z_0-9]+$/.test(error.message)
                ? error.message
                : 'research_error',
          },
          'Research did not complete',
        );
        return reply.code(502).send({
          error: 'research_failed',
          message: 'Не удалось завершить поиск с источниками. Отчёт не создан. Повторите попытку.',
        });
      } finally {
        active.delete(org);
      }
    },
  );
}
