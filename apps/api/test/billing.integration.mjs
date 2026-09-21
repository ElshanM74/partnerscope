/** Real PostgreSQL integration check. NEVER accepts a production database name. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const databaseName = process.env.TEST_DATABASE_NAME ?? '';
const connectionString = process.env.DATABASE_URL ?? '';
let actualName = '';
try {
  actualName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
} catch {
  /* Guard below. */
}
if (!/^ps_release_test_[a-z0-9_]+$/.test(databaseName) || actualName !== databaseName) {
  console.error(
    'Refusing integration run: DATABASE_URL must target TEST_DATABASE_NAME with ps_release_test_ prefix.',
  );
  process.exit(2);
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
const { applyBillingEvent, hasRunEntitlement, billingEntitlements } = await import(
  '../dist/services/billing.js'
);
const { pool: appPool } = await import('../dist/db/client.js');
const pool = new pg.Pool({ connectionString, max: 8 });
const checks = [];
let currentCheck = 'initialize';
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
let serial = 0;
const snapshots = new Map();
const incorrectPrices = new Set();
const deps = {
  pool,
  verifyPrice: async (payment) => !incorrectPrices.has(payment.stripeSessionId),
  subscription: async (id) => {
    assert.ok(snapshots.has(id), 'Subscription fixture must exist');
    return snapshots.get(id);
  },
};
async function check(name, action) {
  currentCheck = name;
  await action();
  checks.push({ name, passed: true });
}
const namespaced = (prefix) => `${prefix}_${suffix}_${++serial}`;
async function createOrg(label) {
  const id = randomUUID();
  const customerId = namespaced('cus');
  await pool.query(
    'INSERT INTO organizations (id,legal_name,country,billing_email,stripe_customer_id) VALUES ($1,$2,$3,$4,$5)',
    [id, `Billing integration ${label}`, 'AZ', `${id}@integration.invalid`, customerId],
  );
  return { id, customerId };
}
async function draft(org, tier = 'starter') {
  const vendorId = randomUUID();
  const runId = randomUUID();
  await pool.query(
    'INSERT INTO vendors (id,organization_id,legal_name,domain,country) VALUES ($1,$2,$3,$4,$5)',
    [vendorId, org.id, 'Integration supplier', `${vendorId}.example.invalid`, 'AZ'],
  );
  await pool.query(
    "INSERT INTO runs (id,vendor_id,organization_id,tier,status) VALUES ($1,$2,$3,$4,'draft')",
    [runId, vendorId, org.id, tier],
  );
  return { org, vendorId, runId, tier };
}
function payment(fixture, overrides = {}) {
  return {
    id: namespaced('evt'),
    type: 'checkout.session.completed',
    data: {
      object: {
        id: namespaced('cs'),
        mode: fixture.tier === 'enterprise' ? 'subscription' : 'payment',
        payment_status: 'paid',
        payment_intent: namespaced('pi'),
        customer: fixture.org.customerId,
        amount_total: 9900,
        currency: 'eur',
        client_reference_id: fixture.org.id,
        metadata: {
          tier: fixture.tier,
          organizationId: fixture.org.id,
          vendorId: fixture.vendorId,
          runId: fixture.runId,
        },
        ...overrides,
      },
    },
  };
}
async function status(runId) {
  return (await pool.query('SELECT status FROM runs WHERE id=$1', [runId])).rows[0].status;
}
async function orderCount(runId) {
  return Number(
    (await pool.query('SELECT count(*) FROM billing_orders WHERE run_id=$1', [runId])).rows[0]
      .count,
  );
}
function refund(event, partial = false) {
  return {
    id: namespaced('evt'),
    type: 'charge.refunded',
    data: {
      object: {
        id: namespaced('ch'),
        payment_intent: event.data.object.payment_intent,
        refunded: !partial,
        amount: 9900,
        amount_refunded: partial ? 1000 : 9900,
      },
    },
  };
}
function enterpriseSnapshot(fixture, id, updates = {}) {
  const future = new Date(Date.now() + 90 * 86400_000);
  return {
    id,
    customerId: fixture.org.customerId,
    status: 'active',
    currentPeriodEnd: future,
    paidUntil: future,
    cancelAtPeriodEnd: false,
    organizationId: fixture.org.id,
    vendorId: fixture.vendorId,
    ...updates,
  };
}
function subscriptionEvent(id, type = 'customer.subscription.updated') {
  return {
    id: namespaced('evt'),
    type,
    data: {
      object: type.startsWith('invoice.')
        ? { id: namespaced('in'), subscription: id }
        : { id, status: 'active' },
    },
  };
}
try {
  const dbName = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  assert.equal(dbName, databaseName, 'Server database must match guarded name');
  const orgs = await Promise.all(['Starter', 'Pro', 'Enterprise'].map(createOrg));
  await check('unpaid organization has free service entitlement', async () => {
    const entitlement = await billingEntitlements(orgs[0].id);
    assert.equal(entitlement.plan, 'free');
    assert.deepEqual(entitlement.activeOrders, []);
  });
  const first = await draft(orgs[0]);
  const firstPayment = payment(first);
  await check(
    'concurrent replay of one event creates exactly one paid order and queues once',
    async () => {
      const results = await Promise.all([
        applyBillingEvent(firstPayment, deps),
        applyBillingEvent(firstPayment, deps),
      ]);
      assert.deepEqual(results.map((result) => result.outcome).sort(), ['duplicate_event', 'paid']);
      assert.equal(await orderCount(first.runId), 1);
      assert.equal(await status(first.runId), 'queued');
      assert.equal(await hasRunEntitlement(first.runId, orgs[0].id), true);
      assert.equal(await hasRunEntitlement(first.runId, orgs[1].id), false);
    },
  );
  await check('different event for same session does not duplicate order', async () => {
    const replay = { ...firstPayment, id: namespaced('evt') };
    assert.equal((await applyBillingEvent(replay, deps)).outcome, 'duplicate_session');
    assert.equal(await orderCount(first.runId), 1);
  });
  await check('stale paid event cannot requeue delivered run', async () => {
    await pool.query("UPDATE runs SET status='delivered' WHERE id=$1", [first.runId]);
    await applyBillingEvent({ ...firstPayment, id: namespaced('evt') }, deps);
    assert.equal(await status(first.runId), 'delivered');
    const newlyPaidSession = payment(first);
    assert.equal((await applyBillingEvent(newlyPaidSession, deps)).outcome, 'binding_mismatch');
    assert.equal(await status(first.runId), 'delivered');
    assert.equal(await orderCount(first.runId), 1);
  });
  await check('foreign run under owned org and vendor is rejected without mutation', async () => {
    const foreign = await draft(orgs[1], 'pro');
    const owned = await draft(orgs[0], 'pro');
    const event = payment(owned);
    event.data.object.metadata.runId = foreign.runId;
    assert.equal((await applyBillingEvent(event, deps)).outcome, 'binding_mismatch');
    assert.equal(await status(foreign.runId), 'draft');
    assert.equal(await orderCount(foreign.runId), 0);
  });
  await check('vendor belonging to another organization is rejected', async () => {
    const foreign = await draft(orgs[1]);
    const event = payment(foreign, {
      customer: orgs[0].customerId,
      client_reference_id: orgs[0].id,
    });
    event.data.object.metadata.organizationId = orgs[0].id;
    assert.equal((await applyBillingEvent(event, deps)).outcome, 'binding_mismatch');
    assert.equal(await status(foreign.runId), 'draft');
    assert.equal(await orderCount(foreign.runId), 0);
  });
  await check('owned but wrong-tier run is rejected', async () => {
    const fixture = await draft(orgs[1], 'pro');
    const event = payment(fixture);
    event.data.object.metadata.tier = 'starter';
    assert.equal((await applyBillingEvent(event, deps)).outcome, 'binding_mismatch');
    assert.equal(await status(fixture.runId), 'draft');
  });
  await check('unpaid, free-tier and malformed metadata do not create entitlement', async () => {
    for (const variation of ['unpaid', 'free_snapshot', 'malformed']) {
      const fixture = await draft(orgs[0]);
      const event = payment(fixture);
      if (variation === 'unpaid') event.data.object.payment_status = 'unpaid';
      if (variation === 'free_snapshot') event.data.object.metadata.tier = 'free_snapshot';
      if (variation === 'malformed') event.data.object.metadata.runId = '../not-a-uuid';
      assert.equal((await applyBillingEvent(event, deps)).acted, false);
      assert.equal(await orderCount(fixture.runId), 0);
      assert.equal(await hasRunEntitlement(fixture.runId, fixture.org.id), false);
    }
  });
  await check('wrong configured price does not authorize service', async () => {
    const fixture = await draft(orgs[0]);
    const event = payment(fixture);
    incorrectPrices.add(event.data.object.id);
    assert.equal((await applyBillingEvent(event, deps)).outcome, 'price_mismatch');
    assert.equal(await orderCount(fixture.runId), 0);
  });
  await check('transient provider failure rolls back event marker and permits retry', async () => {
    const fixture = await draft(orgs[0]);
    const event = payment(fixture);
    await assert.rejects(
      applyBillingEvent(event, {
        ...deps,
        verifyPrice: async () => {
          throw new Error('simulated_provider_outage');
        },
      }),
      /simulated_provider_outage/,
    );
    assert.equal(
      Number(
        (
          await pool.query('SELECT count(*) FROM billing_events WHERE stripe_event_id=$1', [
            event.id,
          ])
        ).rows[0].count,
      ),
      0,
    );
    assert.equal((await applyBillingEvent(event, deps)).outcome, 'paid');
  });
  await check('full refund revokes one-off entitlement; replay cannot restore', async () => {
    const event = refund(firstPayment);
    assert.equal((await applyBillingEvent(event, deps)).outcome, 'one_off_refunded');
    assert.equal(await hasRunEntitlement(first.runId, first.org.id), false);
    assert.equal(
      (await applyBillingEvent({ ...firstPayment, id: namespaced('evt') }, deps)).outcome,
      'payment_refunded',
    );
    assert.equal(await hasRunEntitlement(first.runId, first.org.id), false);
    assert.equal(await status(first.runId), 'delivered');
  });
  await check('refund arriving before checkout is a durable revocation', async () => {
    const fixture = await draft(orgs[1], 'pro');
    const event = payment(fixture);
    await applyBillingEvent(refund(event), deps);
    assert.equal((await applyBillingEvent(event, deps)).outcome, 'payment_refunded');
    assert.equal(await orderCount(fixture.runId), 0);
    assert.equal(await status(fixture.runId), 'draft');
  });
  await check('partial refund retains purchased one-off service', async () => {
    const fixture = await draft(orgs[1], 'pro');
    const event = payment(fixture);
    await applyBillingEvent(event, deps);
    assert.equal((await applyBillingEvent(refund(event, true), deps)).outcome, 'ignored');
    assert.equal(await hasRunEntitlement(fixture.runId, fixture.org.id), true);
  });
  const ent = await draft(orgs[2], 'enterprise');
  const subscriptionId = namespaced('sub');
  snapshots.set(subscriptionId, enterpriseSnapshot(ent, subscriptionId));
  await check('Enterprise paid checkout grants finite subscription period', async () => {
    const event = payment(ent, { subscription: subscriptionId, payment_intent: null });
    assert.equal((await applyBillingEvent(event, deps)).outcome, 'paid');
    assert.equal(await hasRunEntitlement(ent.runId, ent.org.id), true);
    const summary = await billingEntitlements(ent.org.id);
    assert.equal(summary.plan, 'enterprise');
    assert.equal(summary.activeOrders[0].scope, 'subscription');
    assert.equal(summary.researchBeta.requestsPerHour, 5);
  });
  await check('Enterprise expires from paid date even without lifecycle event', async () => {
    await pool.query(
      "UPDATE billing_orders SET paid_until=now()-interval '1 second' WHERE run_id=$1",
      [ent.runId],
    );
    assert.equal(await hasRunEntitlement(ent.runId, ent.org.id), false);
    assert.equal((await billingEntitlements(ent.org.id)).plan, 'free');
  });
  await check('active subscription alone does not renew unpaid expired service', async () => {
    snapshots.set(subscriptionId, enterpriseSnapshot(ent, subscriptionId, { paidUntil: null }));
    await applyBillingEvent(subscriptionEvent(subscriptionId), deps);
    assert.equal(await hasRunEntitlement(ent.runId, ent.org.id), false);
  });
  await check(
    'paid invoice extends period; scheduled cancellation preserves paid access',
    async () => {
      snapshots.set(
        subscriptionId,
        enterpriseSnapshot(ent, subscriptionId, { cancelAtPeriodEnd: true }),
      );
      await applyBillingEvent(subscriptionEvent(subscriptionId, 'invoice.paid'), deps);
      assert.equal(await hasRunEntitlement(ent.runId, ent.org.id), true);
      const order = (await billingEntitlements(ent.org.id)).activeOrders[0];
      assert.equal(order.cancelAtPeriodEnd, true);
    },
  );
  await check(
    'current cancelled state defeats stale active payload and disables access',
    async () => {
      await pool.query("UPDATE runs SET status='delivered' WHERE id=$1", [ent.runId]);
      snapshots.set(
        subscriptionId,
        enterpriseSnapshot(ent, subscriptionId, { status: 'canceled' }),
      );
      await applyBillingEvent(subscriptionEvent(subscriptionId), deps);
      assert.equal(await hasRunEntitlement(ent.runId, ent.org.id), false);
      assert.equal(await status(ent.runId), 'delivered');
    },
  );
  await check('foreign customer subscription snapshot cannot grant access', async () => {
    snapshots.set(
      subscriptionId,
      enterpriseSnapshot(ent, subscriptionId, { customerId: orgs[0].customerId }),
    );
    assert.equal(
      (await applyBillingEvent(subscriptionEvent(subscriptionId), deps)).outcome,
      'binding_mismatch',
    );
    assert.equal(await hasRunEntitlement(ent.runId, ent.org.id), false);
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        database: databaseName,
        checksPassed: checks.length,
        checks,
        provider: 'deterministic boundary; no Stripe calls',
        databaseMode: 'real PostgreSQL, isolated disposable database',
        cleanup: 'drop disposable database after run',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      check: currentCheck,
      checksPassed: checks.length,
      error: error?.code ?? error?.name ?? 'integration_failure',
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
  await appPool.end();
}
