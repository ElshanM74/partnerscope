import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';
import { researchRoutes } from './research.js';

const org = 'f7712711-90d4-4e21-a7a5-d443315c8389';
const otherOrg = 'eb918de3-90b3-42a6-9999-89a4dfc05a01';
const user = '214f8785-4eef-4f23-9cb2-d56cf0a00cf4';
const validBody = {
  mode: 'check',
  company: 'Example supplier',
  country: 'Azerbaijan',
  task: 'Find evidence of fibre construction experience',
  criteria: 'Team and delivery deadlines',
};

// The upstream auth plugin is outside this route regression suite. Inject its
// resolved identity, then exercise the actual membership guard and handlers.
async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-test-auth'] !== 'member') return;
    const organizationId = req.headers['x-test-org'] === 'other' ? otherOrg : org;
    req.organization = { id: organizationId, legalName: 'Test organization' };
    req.user = {
      sub: user,
      org: organizationId,
      email: 'test@example.invalid',
      role: 'admin',
    };
  });
  await app.register(researchRoutes);
  await app.ready();
  return app;
}

const memberHeaders = { 'x-test-auth': 'member' };

describe('research routes: membership and request boundaries', () => {
  let app: FastifyInstance;
  let directory: string;
  let previousStorage: string;
  let previousKey: string | undefined;
  let query: ReturnType<typeof vi.spyOn>;
  let provider: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'partnerscope-research-route-'));
    previousStorage = env.STORAGE_LOCAL_DIR;
    previousKey = env.OPENAI_API_KEY;
    env.STORAGE_LOCAL_DIR = directory;
    env.OPENAI_API_KEY = 'test-route-never-sent';
    query = vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ id: user }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    provider = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected provider call'));
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    env.STORAGE_LOCAL_DIR = previousStorage;
    env.OPENAI_API_KEY = previousKey;
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('rejects missing authentication before database or provider access', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const response = await app.inject({
        method,
        url: '/v1/research',
        ...(method === 'POST' ? { payload: validBody } : {}),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    }
    expect(query).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects a deleted user on list, detail, and create without calling the provider', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });
    const calls = [
      { method: 'GET' as const, url: '/v1/research' },
      { method: 'GET' as const, url: `/v1/research/${user}` },
      { method: 'POST' as const, url: '/v1/research', payload: validBody },
    ];
    for (const call of calls) {
      const response = await app.inject({ ...call, headers: memberHeaders });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    }
    expect(query).toHaveBeenCalledWith(
      'SELECT id FROM users WHERE id = $1 AND organization_id = $2',
      [user, org],
    );
    expect(provider).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('returns an empty history for a valid current member using the real filesystem store', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/research',
      headers: memberHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reports: [] });
    expect(query).toHaveBeenCalledWith(
      'SELECT id FROM users WHERE id = $1 AND organization_id = $2',
      [user, org],
    );
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects incomplete check requests before provider execution', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/research',
      headers: memberHeaders,
      payload: { ...validBody, company: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');
    expect(provider).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('distinguishes invalid report identifiers from missing saved reports', async () => {
    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/research/not-a-uuid',
      headers: memberHeaders,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('invalid_id');
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/research/${user}`,
      headers: memberHeaders,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('not_found');
    expect(provider).not.toHaveBeenCalled();
  });

  it('enforces the five-request organization quota without leaking it to another organization', async () => {
    // Invalid requests count toward rate limits without invoking a paid provider.
    for (let index = 0; index < 5; index++) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/research',
        headers: memberHeaders,
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/v1/research',
      headers: memberHeaders,
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
    const separate = await app.inject({
      method: 'POST',
      url: '/v1/research',
      headers: { ...memberHeaders, 'x-test-org': 'other' },
      payload: {},
    });
    expect(separate.statusCode).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
});
