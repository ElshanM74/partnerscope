import type { Pool, PoolClient } from 'pg';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  type BillingDependencies,
  type BillingOrder,
  applyBillingEvent,
  orderIsActive,
  summarizeEntitlements,
} from './billing.js';
import {
  type SubscriptionSnapshot,
  checkoutRedirect,
  parseCheckoutCompleted,
} from './stripe/index.js';

const org = '00000000-0000-4000-8000-000000000001';
const vendor = '00000000-0000-4000-8000-000000000002';
const run = '00000000-0000-4000-8000-000000000003';
function checkout(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: 'evt_billing',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_billing',
        mode: 'payment',
        payment_status: 'paid',
        customer: 'cus_billing',
        payment_intent: 'pi_billing',
        amount_total: 9900,
        currency: 'eur',
        metadata: { tier: 'starter', organizationId: org, vendorId: vendor, runId: run },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}
function snapshot(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    id: 'sub_billing',
    customerId: 'cus_billing',
    status: 'active',
    currentPeriodEnd: new Date('2099-01-01'),
    paidUntil: new Date('2099-01-01'),
    cancelAtPeriodEnd: false,
    organizationId: org,
    vendorId: vendor,
    ...overrides,
  };
}
function order(overrides: Partial<BillingOrder> = {}): BillingOrder {
  return {
    id: 'order',
    runId: run,
    vendorId: vendor,
    tier: 'starter',
    status: 'paid',
    subscriptionStatus: null,
    paidUntil: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}
// Database boundary stub: validates business decisions and transaction sequencing;
// database unique/FK guarantees also require the deployment integration check.
function database(
  options: {
    duplicateEvent?: boolean;
    refunded?: boolean;
    duplicateSession?: boolean;
    runStatus?: string;
    wrongOrg?: boolean;
    tier?: string;
    subscription?: boolean;
  } = {},
) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    writes.push({ sql, values });
    let rows: unknown[] = [];
    if (sql.startsWith('SELECT stripe_payment_intent FROM billing_refunds'))
      rows = options.refunded ? [{ stripe_payment_intent: 'pi_billing' }] : [];
    else if (sql.startsWith('INSERT INTO billing_events'))
      rows = options.duplicateEvent ? [] : [{ stripe_event_id: 'evt_billing' }];
    else if (sql.startsWith('SELECT id FROM billing_orders WHERE stripe_session_id'))
      rows = options.duplicateSession ? [{ id: 'order' }] : [];
    else if (sql.startsWith('SELECT v.id'))
      rows = [{ id: vendor, stripe_customer_id: 'cus_billing' }];
    else if (sql.startsWith('SELECT id,status,tier'))
      rows = [
        {
          id: run,
          status: options.runStatus ?? 'draft',
          tier: options.tier ?? 'starter',
          vendor_id: vendor,
          organization_id: options.wrongOrg ? 'other' : org,
        },
      ];
    else if (sql.startsWith('SELECT id FROM billing_orders WHERE stripe_subscription_id'))
      rows = options.subscription ? [{ id: 'order' }] : [];
    else if (sql.startsWith('SELECT organization_id'))
      rows = [{ organization_id: org, vendor_id: vendor, stripe_customer_id: 'cus_billing' }];
    return { rows, rowCount: rows.length };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const deps: BillingDependencies = {
    pool: { connect: async () => client } as Pick<Pool, 'connect'>,
    verifyPrice: vi.fn(async () => true),
    subscription: vi.fn(async () => snapshot()),
  };
  return { deps, writes, query, release };
}

describe('Paid service boundaries', () => {
  it('keeps one-off service tied to purchased run, research allowance unchanged', () => {
    const result = summarizeEntitlements([order()]);
    expect(result.plan).toBe('starter');
    expect(result.activeOrders[0]).toMatchObject({ runId: run, scope: 'run' });
    expect(result.researchBeta).toEqual({ requestsPerHour: 5, paidPlanRequired: false });
    expect(summarizeEntitlements([]).plan).toBe('free');
  });
  it('expires Enterprise even without a webhook and keeps scheduled cancellation until paid end', () => {
    expect(
      orderIsActive(
        order({ tier: 'enterprise', subscriptionStatus: 'active', paidUntil: '2020-01-01' }),
      ),
    ).toBe(false);
    expect(
      orderIsActive(
        order({
          tier: 'enterprise',
          subscriptionStatus: 'active',
          paidUntil: '2099-01-01',
          cancelAtPeriodEnd: true,
        }),
      ),
    ).toBe(true);
    expect(
      orderIsActive(
        order({ tier: 'enterprise', subscriptionStatus: 'canceled', paidUntil: '2099-01-01' }),
      ),
    ).toBe(false);
    expect(
      orderIsActive(order({ tier: 'enterprise', subscriptionStatus: 'active', paidUntil: null })),
    ).toBe(false);
  });
  it('rejects unpaid, trial-only, invalid UUID, unknown tier and wrong mode checkout', () => {
    for (const payment_status of ['unpaid', 'no_payment_required'])
      expect(parseCheckoutCompleted(checkout({ payment_status }))).toBeNull();
    expect(
      parseCheckoutCompleted(
        checkout({ metadata: { tier: 'enterprise', organizationId: 'bad', vendorId: vendor } }),
      ),
    ).toBeNull();
    expect(
      parseCheckoutCompleted(
        checkout({ metadata: { tier: 'god', organizationId: org, vendorId: vendor } }),
      ),
    ).toBeNull();
    expect(parseCheckoutCompleted(checkout({ mode: 'subscription' }))).toBeNull();
    expect(parseCheckoutCompleted(checkout({ client_reference_id: 'other' }))).toBeNull();
    expect(parseCheckoutCompleted(checkout())).not.toBeNull();
  });
  it('accepts delayed payment success only when actually paid', () => {
    const event = checkout();
    event.type = 'checkout.session.async_payment_succeeded';
    expect(parseCheckoutCompleted(event)?.stripeSessionId).toBe('cs_billing');
  });
  it('allowlists same-origin return paths and removes user query parameters', () => {
    expect(
      checkoutRedirect(
        'http://localhost:5173/checkout/success?redirect=https://evil.example',
        'success',
      ),
    ).toBe('http://localhost:5173/checkout/success?session_id={CHECKOUT_SESSION_ID}');
    for (const url of [
      'https://evil.example/checkout/success',
      'http://localhost:5173/login',
      'http://u:p@localhost:5173/checkout/success',
    ])
      expect(() => checkoutRedirect(url, 'success')).toThrow();
  });
});

describe('Transactional Stripe delivery ledger', () => {
  it('queues a matching paid draft and writes the run-scoped order once', async () => {
    const db = database();
    expect(await applyBillingEvent(checkout(), db.deps)).toMatchObject({
      acted: true,
      outcome: 'paid',
    });
    expect(db.writes.filter((q) => q.sql.startsWith('INSERT INTO billing_orders'))).toHaveLength(1);
    expect(db.writes.find((q) => q.sql.startsWith('UPDATE runs'))?.values).toContain(run);
    expect(db.writes.at(-1)?.sql).toBe('COMMIT');
    expect(db.release).toHaveBeenCalledOnce();
  });
  it('does not run provider work or modify run on a repeated event', async () => {
    const db = database({ duplicateEvent: true });
    expect(await applyBillingEvent(checkout(), db.deps)).toMatchObject({
      outcome: 'duplicate_event',
    });
    expect(db.deps.verifyPrice).not.toHaveBeenCalled();
    expect(db.writes.some((q) => q.sql.startsWith('UPDATE runs'))).toBe(false);
  });
  it('deduplicates another event for the same Checkout session', async () => {
    const db = database({ duplicateSession: true });
    expect(await applyBillingEvent(checkout(), db.deps)).toMatchObject({
      outcome: 'duplicate_session',
    });
    expect(db.writes.some((q) => q.sql.startsWith('INSERT INTO billing_orders'))).toBe(false);
  });
  it('never changes another org run, mismatched tier, or a delivered run', async () => {
    for (const options of [{ wrongOrg: true }, { tier: 'pro' }, { runStatus: 'delivered' }]) {
      const db = database(options);
      expect(await applyBillingEvent(checkout(), db.deps)).toMatchObject({
        acted: false,
        outcome: 'binding_mismatch',
      });
      expect(
        db.writes.some(
          (q) => q.sql.startsWith('UPDATE runs') || q.sql.startsWith('INSERT INTO billing_orders'),
        ),
      ).toBe(false);
    }
  });
  it('refuses a paid session for a different configured Stripe price', async () => {
    const db = database();
    db.deps.verifyPrice = async () => false;
    expect(await applyBillingEvent(checkout(), db.deps)).toMatchObject({
      outcome: 'price_mismatch',
    });
    expect(db.writes.some((q) => q.sql.startsWith('INSERT INTO billing_orders'))).toBe(false);
  });
  it('rolls back the event marker on provider error so retry is possible', async () => {
    const db = database();
    db.deps.verifyPrice = async () => {
      throw new Error('provider down');
    };
    await expect(applyBillingEvent(checkout(), db.deps)).rejects.toThrow('provider down');
    expect(db.writes.at(-1)?.sql).toBe('ROLLBACK');
    expect(db.release).toHaveBeenCalledOnce();
  });
  it('uses current provider status on delayed subscription events, not stale event status', async () => {
    const db = database({ subscription: true });
    db.deps.subscription = async () => snapshot({ status: 'canceled' });
    const event = {
      id: 'evt_sub',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_billing', status: 'active' } },
    } as Stripe.Event;
    expect(await applyBillingEvent(event, db.deps)).toMatchObject({
      outcome: 'subscription_updated',
    });
    const update = db.writes.find((q) => q.sql.startsWith('UPDATE billing_orders'));
    expect(update?.values.slice(0, 3)).toEqual(['sub_billing', 'inactive', 'canceled']);
    expect(db.writes.some((q) => q.sql.startsWith('UPDATE runs'))).toBe(false);
  });
  it('does not grant a paid renewal based on active status alone', async () => {
    const db = database({ subscription: true });
    db.deps.subscription = async () => snapshot({ paidUntil: null });
    const event = {
      id: 'evt_sub',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_billing' } },
    } as Stripe.Event;
    await applyBillingEvent(event, db.deps);
    expect(db.writes.find((q) => q.sql.startsWith('UPDATE billing_orders'))?.values[3]).toBeNull();
  });
  it('revokes full one-off refund and stores a tombstone even before checkout is processed', async () => {
    const db = database();
    const event = {
      id: 'evt_refund',
      type: 'charge.refunded',
      data: {
        object: {
          refunded: true,
          amount: 9900,
          amount_refunded: 9900,
          payment_intent: 'pi_billing',
        },
      },
    } as Stripe.Event;
    expect(await applyBillingEvent(event, db.deps)).toMatchObject({
      acted: true,
      outcome: 'one_off_refunded',
    });
    expect(db.writes.some((q) => q.sql.startsWith('INSERT INTO billing_refunds'))).toBe(true);
    expect(db.writes.find((q) => q.sql.startsWith('UPDATE billing_orders'))?.values).toEqual([
      'pi_billing',
    ]);
    expect(db.writes.some((q) => q.sql.startsWith('UPDATE runs'))).toBe(false);
    const delayed = database({ refunded: true });
    expect(await applyBillingEvent(checkout(), delayed.deps)).toMatchObject({
      acted: false,
      outcome: 'payment_refunded',
    });
    expect(delayed.writes.some((q) => q.sql.startsWith('INSERT INTO billing_orders'))).toBe(false);
    expect(delayed.deps.verifyPrice).not.toHaveBeenCalled();
  });
  it('does not revoke the purchased service on a partial refund', async () => {
    const db = database();
    const event = {
      id: 'evt_partial',
      type: 'charge.refunded',
      data: {
        object: {
          refunded: false,
          amount: 9900,
          amount_refunded: 1000,
          payment_intent: 'pi_billing',
        },
      },
    } as Stripe.Event;
    expect(await applyBillingEvent(event, db.deps)).toMatchObject({
      acted: false,
      outcome: 'ignored',
    });
    expect(
      db.writes.some(
        (q) =>
          q.sql.startsWith('INSERT INTO billing_refunds') ||
          q.sql.startsWith('UPDATE billing_orders'),
      ),
    ).toBe(false);
  });
  it('refuses a subscription snapshot belonging to another Stripe customer', async () => {
    const db = database({ subscription: true });
    db.deps.subscription = async () => snapshot({ customerId: 'cus_other' });
    const event = {
      id: 'evt_sub',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_billing' } },
    } as Stripe.Event;
    expect(await applyBillingEvent(event, db.deps)).toMatchObject({ outcome: 'binding_mismatch' });
    expect(db.writes.some((q) => q.sql.startsWith('UPDATE billing_orders'))).toBe(false);
  });
});
