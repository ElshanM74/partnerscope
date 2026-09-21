import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  create: vi.fn(),
  run: { id: '00000000-0000-4000-8000-000000000003', tier: 'starter', status: 'draft' } as Record<
    string,
    unknown
  > | null,
  staffExists: true,
}));
vi.mock('../db/client.js', () => ({
  pool: {
    query: fakes.query,
    connect: async () => ({ query: fakes.query, release: fakes.release }),
  },
  db: {},
}));
vi.mock('../services/billing.js', () => ({
  billingEntitlements: async () => ({ plan: 'free', activeOrders: [] }),
}));
vi.mock('../services/stripe/index.js', async (load) => {
  const actual = await load<typeof import('../services/stripe/index.js')>();
  return { ...actual, createCheckoutSession: fakes.create };
});
import { env } from '../config/env.js';
import { checkoutRoutes } from './checkout.js';
const org = '00000000-0000-4000-8000-000000000001';
const vendor = '00000000-0000-4000-8000-000000000002';
const run = '00000000-0000-4000-8000-000000000003';
const request = {
  tier: 'starter',
  vendorId: vendor,
  runId: run,
  buyerEmail: 'billing@example.com',
};
async function app(role = 'admin') {
  const server = Fastify();
  server.addHook('onRequest', async (req) => {
    req.organization = { id: org, legalName: 'Test' };
    Object.assign(req, { user: { sub: org, org, role } });
  });
  await server.register(checkoutRoutes);
  return server;
}
beforeEach(() => {
  vi.clearAllMocks();
  env.STAFF_EMAILS = ['staff@example.com'];
  fakes.staffExists = true;
  fakes.run = { id: run, tier: 'starter', status: 'draft' };
  fakes.create.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' });
  fakes.query.mockImplementation(async (sql: string) => {
    let rows: unknown[] = [];
    if (sql.includes('lower(email::text)')) rows = fakes.staffExists ? [{ id: org }] : [];
    else if (sql.startsWith('SELECT id FROM users')) rows = [{ id: org }];
    else if (sql.startsWith('SELECT id FROM vendors')) rows = [{ id: vendor }];
    else if (sql.startsWith('SELECT id,tier,status')) rows = fakes.run ? [fakes.run] : [];
    return { rows, rowCount: rows.length };
  });
});
describe('Checkout run binding', () => {
  it('accepts Starter and passes only the owned draft to payment service', async () => {
    const server = await app();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/checkout/session',
        payload: request,
      });
      expect(response.statusCode).toBe(200);
      expect(fakes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: run,
          vendorId: vendor,
          organizationId: org,
          tier: 'starter',
        }),
      );
    } finally {
      await server.close();
    }
  });
  it('refuses foreign vendor/run binding before calling Stripe', async () => {
    fakes.run = null;
    const server = await app();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/checkout/session',
        payload: request,
      });
      expect(response.statusCode).toBe(404);
      expect(fakes.create).not.toHaveBeenCalled();
      expect(fakes.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
      expect(fakes.release).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });
  it('refuses delivered and wrong-tier runs before payment', async () => {
    for (const invalid of [
      { id: run, tier: 'pro', status: 'draft' },
      { id: run, tier: 'starter', status: 'delivered' },
    ]) {
      fakes.run = invalid;
      const server = await app();
      try {
        const response = await server.inject({
          method: 'POST',
          url: '/v1/checkout/session',
          payload: request,
        });
        expect(response.statusCode).toBe(409);
      } finally {
        await server.close();
      }
    }
    expect(fakes.create).not.toHaveBeenCalled();
  });
  it('refuses arbitrary redirect before creating a draft or payment session', async () => {
    const server = await app();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/checkout/session',
        payload: { ...request, successUrl: 'https://evil.example/checkout/success' },
      });
      expect(response.statusCode).toBe(400);
      expect(fakes.create).not.toHaveBeenCalled();
      expect(fakes.query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false);
    } finally {
      await server.close();
    }
  });
  it('refuses generic Enterprise checkout without an approved run before Stripe', async () => {
    const server = await app();
    try {
      const { runId: _runId, ...generic } = request;
      const response = await server.inject({
        method: 'POST',
        url: '/v1/checkout/session',
        payload: { ...generic, tier: 'enterprise' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().code ?? response.json().error).toBeDefined();
      expect(fakes.create).not.toHaveBeenCalled();
      expect(fakes.query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false);
    } finally {
      await server.close();
    }
  });
  it('refuses an Enterprise draft with missing or incomplete contract approval', async () => {
    for (const reportJson of [
      null,
      {},
      { enterpriseScopeApproved: true },
      {
        enterpriseScopeApproved: true,
        scopeApproval: { staffUserId: org, contractReference: '   ' },
      },
    ]) {
      fakes.run = { id: run, tier: 'enterprise', status: 'draft', reportJson };
      const server = await app();
      try {
        expect(
          (
            await server.inject({
              method: 'POST',
              url: '/v1/checkout/session',
              payload: { ...request, tier: 'enterprise' },
            })
          ).statusCode,
        ).toBe(409);
      } finally {
        await server.close();
      }
    }
    expect(fakes.create).not.toHaveBeenCalled();
  });
  it('allows a contracted Enterprise draft approved by an existing authorized staff member', async () => {
    fakes.run = {
      id: run,
      tier: 'enterprise',
      status: 'draft',
      reportJson: {
        enterpriseScopeApproved: true,
        scopeApproval: {
          staffUserId: org,
          contractReference: 'CONTRACT-2026-001',
          scope: 'Approved portfolio scope',
          approvedAt: '2026-09-21T12:00:00Z',
        },
      },
    };
    const server = await app();
    try {
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/v1/checkout/session',
            payload: { ...request, tier: 'enterprise' },
          })
        ).statusCode,
      ).toBe(200);
      expect(fakes.create).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'enterprise', runId: run }),
      );
      fakes.create.mockClear();
      fakes.staffExists = false;
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/v1/checkout/session',
            payload: { ...request, tier: 'enterprise' },
          })
        ).statusCode,
      ).toBe(409);
      expect(fakes.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
  it('allows viewer to inspect own entitlements but not to start payment', async () => {
    const server = await app('viewer');
    try {
      expect((await server.inject('/v1/billing/entitlements')).statusCode).toBe(200);
      expect(
        (await server.inject({ method: 'POST', url: '/v1/checkout/session', payload: request }))
          .statusCode,
      ).toBe(403);
      expect(fakes.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
