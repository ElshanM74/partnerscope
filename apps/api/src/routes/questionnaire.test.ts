import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../db/client.js';
import { questionnaireRoutes } from './questionnaire.js';
const org = 'f7712711-90d4-4e21-a7a5-d443315c8389';
const vendor = 'eb918de3-90b3-42a6-9999-89a4dfc05a01';
const user = '214f8785-4eef-4f23-9cb2-d56cf0a00cf4';
const rows = (values: unknown[]) => ({
  rows: values,
  rowCount: values.length,
  command: 'SELECT',
  oid: 0,
  fields: [],
});
describe('questionnaire tenant boundaries', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = Fastify();
    app.addHook('onRequest', async (req) => {
      if (req.headers['x-member'] === 'yes') {
        req.organization = { id: org, legalName: 'Test' };
        req.user = { sub: user, org, email: 'test@example.invalid', role: 'admin' };
      }
    });
    await app.register(questionnaireRoutes);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  it('rejects missing authentication and deleted membership', async () => {
    const query = vi.spyOn(pool, 'query').mockResolvedValue(rows([]));
    expect((await app.inject('/v1/questions/intake')).statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
    expect(
      (await app.inject({ url: '/v1/questions/intake', headers: { 'x-member': 'yes' } }))
        .statusCode,
    ).toBe(401);
  });
  it('does not reveal a foreign vendor or query its run history', async () => {
    const query = vi
      .spyOn(pool, 'query')
      .mockResolvedValueOnce(rows([{ id: user }]))
      .mockResolvedValueOnce(rows([]));
    const response = await app.inject({
      url: `/v1/vendors/${vendor}/detail`,
      headers: { 'x-member': 'yes' },
    });
    expect(response.statusCode).toBe(404);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('organization_id=$2');
    expect(query.mock.calls[1][1]).toEqual([vendor, org]);
  });
  it('scopes a requested saved run to both vendor and organization', async () => {
    const query = vi
      .spyOn(pool, 'query')
      .mockResolvedValueOnce(rows([{ id: user }]))
      .mockResolvedValueOnce(rows([{ id: vendor }]))
      .mockResolvedValueOnce(rows([]));
    const response = await app.inject({
      url: `/v1/vendors/${vendor}/detail?runId=${user}`,
      headers: { 'x-member': 'yes' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('run_not_found');
    expect(query.mock.calls[2][0]).toContain('vendor_id=$1 AND organization_id=$2');
    expect(query.mock.calls[2][1]).toEqual([vendor, org, user]);
  });
  it('rejects invalid answers before opening a transaction', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue(rows([{ id: user }]));
    const connect = vi.spyOn(pool, 'connect');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/vendors/${vendor}/assess`,
      headers: { 'x-member': 'yes' },
      payload: { answers: [{ questionId: 'Q01_1', value: 99 }] },
    });
    expect(response.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it('persists only supplied answers in one transaction without calculated scores', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue(rows([{ id: user }]));
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id, legal_name')) return rows([{ id: vendor }]);
      if (sql.startsWith('SELECT id, role FROM users')) return rows([{ id: user }]);
      if (sql.startsWith('INSERT INTO runs')) return rows([{ id: user }]);
      return rows([]);
    });
    const release = vi.fn();
    vi.spyOn(pool, 'connect').mockResolvedValue({
      query: txQuery,
      release,
    } as unknown as PoolClient);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/vendors/${vendor}/assess`,
      headers: { 'x-member': 'yes' },
      payload: {
        answers: [
          { questionId: 'Q01_1', value: 3 },
          { questionId: 'Q01_2', unknown: true },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ runId: user });
    const statements = txQuery.mock.calls.map((call) => call[0]);
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.filter((sql) => sql.startsWith('INSERT INTO responses'))).toHaveLength(2);
    expect(statements.find((sql) => sql.startsWith('INSERT INTO runs'))).toContain(
      "'delivered',NULL,NULL",
    );
    expect(
      statements
        .filter((sql) => sql.startsWith('INSERT INTO questions'))
        .every((sql) => sql.includes('ON CONFLICT (id) DO NOTHING')),
    ).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
  it('rolls back assessment creation for a vendor outside the organization', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue(rows([{ id: user }]));
    const txQuery = vi.fn().mockResolvedValue(rows([]));
    const release = vi.fn();
    vi.spyOn(pool, 'connect').mockResolvedValue({
      query: txQuery,
      release,
    } as unknown as PoolClient);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/vendors/${vendor}/assess`,
      headers: { 'x-member': 'yes' },
      payload: { answers: [{ questionId: 'Q01_1', value: 3 }] },
    });
    expect(response.statusCode).toBe(404);
    expect(txQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(txQuery.mock.calls.some((call) => String(call[0]).startsWith('INSERT'))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
  it('returns only actual organization monitoring records', async () => {
    const query = vi
      .spyOn(pool, 'query')
      .mockResolvedValueOnce(rows([{ id: user }]))
      .mockResolvedValueOnce(rows([]));
    const response = await app.inject({
      url: '/v1/monitoring/feed',
      headers: { 'x-member': 'yes' },
    });
    expect(response.json()).toEqual({ data: [] });
    expect(query.mock.calls[1][0]).toContain('v.organization_id=$1');
    expect(query.mock.calls[1][1]).toEqual([org]);
  });
});
