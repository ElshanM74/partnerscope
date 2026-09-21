import { getEntitlements } from '@partnerscope/core';
import type { Pool, PoolClient } from 'pg';
import type Stripe from 'stripe';
import { pool } from '../db/client.js';
import {
  type PaidTier,
  type SubscriptionSnapshot,
  parseCheckoutCompleted,
  retrieveSubscriptionSnapshot,
  subscriptionIdForEvent,
  verifyCheckoutPrice,
} from './stripe/index.js';

export interface BillingOrder {
  id: string;
  runId: string;
  vendorId: string;
  tier: PaidTier;
  status: 'paid' | 'inactive';
  subscriptionStatus: string | null;
  paidUntil: Date | string | null;
  cancelAtPeriodEnd: boolean;
}
export function orderIsActive(order: BillingOrder, now = new Date()): boolean {
  return (
    order.status === 'paid' &&
    (order.tier !== 'enterprise' ||
      (order.subscriptionStatus === 'active' &&
        !!order.paidUntil &&
        new Date(order.paidUntil) > now))
  );
}
const orderSelect =
  'SELECT id, run_id AS "runId", vendor_id AS "vendorId", tier, status, subscription_status AS "subscriptionStatus", paid_until AS "paidUntil", cancel_at_period_end AS "cancelAtPeriodEnd" FROM billing_orders';
export async function hasRunEntitlement(runId: string, organizationId: string): Promise<boolean> {
  const rows = await pool.query(`${orderSelect} WHERE run_id=$1 AND organization_id=$2`, [
    runId,
    organizationId,
  ]);
  return rows.rows.some((order: BillingOrder) => orderIsActive(order));
}
export function summarizeEntitlements(orders: BillingOrder[], now = new Date()) {
  const activeOrders = orders
    .filter((order) => orderIsActive(order, now))
    .map((order) => ({
      ...order,
      scope: order.tier === 'enterprise' ? ('subscription' as const) : ('run' as const),
    }));
  const plan =
    ['enterprise', 'pro', 'starter'].find((tier) =>
      activeOrders.some((order) => order.tier === tier),
    ) ?? 'free';
  return {
    plan,
    scope: 'purchased_services',
    activeOrders,
    researchBeta: { requestsPerHour: 5, paidPlanRequired: false },
    note: 'Starter and Pro purchases cover the listed runs only. Research beta access is the same for all accounts.',
  };
}
export async function billingEntitlements(organizationId: string) {
  const result = await pool.query(
    `${orderSelect} WHERE organization_id=$1 ORDER BY created_at DESC`,
    [organizationId],
  );
  return summarizeEntitlements(result.rows);
}

export interface BillingDependencies {
  pool: Pick<Pool, 'connect'>;
  verifyPrice: typeof verifyCheckoutPrice;
  subscription: typeof retrieveSubscriptionSnapshot;
}
const dependencies: BillingDependencies = {
  pool,
  verifyPrice: verifyCheckoutPrice,
  subscription: retrieveSubscriptionSnapshot,
};

async function updateSubscription(
  client: PoolClient,
  snapshot: SubscriptionSnapshot,
): Promise<boolean> {
  const order = (
    await client.query(
      'SELECT organization_id, vendor_id, stripe_customer_id FROM billing_orders WHERE stripe_subscription_id=$1 FOR UPDATE',
      [snapshot.id],
    )
  ).rows[0];
  if (
    !order ||
    order.stripe_customer_id !== snapshot.customerId ||
    (snapshot.organizationId && snapshot.organizationId !== order.organization_id) ||
    (snapshot.vendorId && snapshot.vendorId !== order.vendor_id)
  )
    return false;
  // A paid invoice can extend service; a mere active subscription cannot.
  // Immediate cancellation/revocation disables it; scheduled cancellation lasts to the paid boundary.
  await client.query(
    `UPDATE billing_orders SET status=$2, subscription_status=$3,
      paid_until=CASE WHEN $4::timestamptz IS NULL THEN paid_until ELSE GREATEST(paid_until,$4::timestamptz) END,
      cancel_at_period_end=$5, updated_at=now() WHERE stripe_subscription_id=$1`,
    [
      snapshot.id,
      snapshot.status === 'active' ? 'paid' : 'inactive',
      snapshot.status,
      snapshot.paidUntil,
      snapshot.cancelAtPeriodEnd,
    ],
  );
  if (snapshot.status === 'active')
    await client.query(
      "UPDATE runs r SET status='queued',started_at=now(),updated_at=now() FROM billing_orders b WHERE b.run_id=r.id AND b.stripe_subscription_id=$1 AND b.status='paid' AND b.paid_until>now() AND r.status='draft'",
      [snapshot.id],
    );
  return true;
}

/** Atomic event/session ledger plus tenant-bound purchase. No provider event body is persisted. */
export async function applyBillingEvent(event: Stripe.Event, deps = dependencies) {
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    const accepted = await client.query(
      "INSERT INTO billing_events (stripe_event_id,event_type,outcome) VALUES ($1,$2,'processing') ON CONFLICT (stripe_event_id) DO NOTHING RETURNING stripe_event_id",
      [event.id, event.type],
    );
    if (!accepted.rowCount) {
      await client.query('COMMIT');
      return { acted: false, outcome: 'duplicate_event' };
    }
    let outcome = 'ignored';
    const payment = parseCheckoutCompleted(event);
    const charge = event.type === 'charge.refunded' ? (event.data.object as Stripe.Charge) : null;
    const refundedIntent =
      charge?.refunded && charge.amount > 0 && charge.amount_refunded >= charge.amount
        ? typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id
        : null;
    if (refundedIntent) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payment:${refundedIntent}`,
      ]);
      // Keep the revocation even if refund arrives before Checkout's delivery event.
      await client.query(
        'INSERT INTO billing_refunds (stripe_payment_intent,stripe_event_id) VALUES ($1,$2) ON CONFLICT (stripe_payment_intent) DO NOTHING',
        [refundedIntent, event.id],
      );
      await client.query(
        "UPDATE billing_orders SET status='inactive',updated_at=now() WHERE stripe_payment_intent=$1 AND tier IN ('starter','pro')",
        [refundedIntent],
      );
      outcome = 'one_off_refunded';
    } else if (payment) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `checkout:${payment.stripeSessionId}`,
      ]);
      if (payment.stripePaymentIntent)
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `payment:${payment.stripePaymentIntent}`,
        ]);
      const revoked =
        payment.stripePaymentIntent && payment.tier !== 'enterprise'
          ? (
              await client.query(
                'SELECT stripe_payment_intent FROM billing_refunds WHERE stripe_payment_intent=$1',
                [payment.stripePaymentIntent],
              )
            ).rowCount
          : 0;
      const existing = await client.query(
        'SELECT id FROM billing_orders WHERE stripe_session_id=$1',
        [payment.stripeSessionId],
      );
      if (revoked) outcome = 'payment_refunded';
      else if (existing.rowCount) outcome = 'duplicate_session';
      else if (!(await deps.verifyPrice(payment))) outcome = 'price_mismatch';
      else {
        const vendor = (
          await client.query(
            'SELECT v.id, o.stripe_customer_id FROM vendors v JOIN organizations o ON o.id=v.organization_id WHERE v.id=$1 AND v.organization_id=$2 FOR UPDATE OF v,o',
            [payment.vendorId, payment.organizationId],
          )
        ).rows[0];
        let runId = payment.runId;
        let valid =
          !!vendor &&
          !!payment.stripeCustomerId &&
          (!vendor.stripe_customer_id || vendor.stripe_customer_id === payment.stripeCustomerId);
        if (valid && runId) {
          const run = (
            await client.query(
              'SELECT id,status,tier,vendor_id,organization_id FROM runs WHERE id=$1 FOR UPDATE',
              [runId],
            )
          ).rows[0];
          valid =
            !!run &&
            run.organization_id === payment.organizationId &&
            run.vendor_id === payment.vendorId &&
            run.tier === payment.tier &&
            run.status === 'draft';
          if (
            valid &&
            (await client.query('SELECT id FROM billing_orders WHERE run_id=$1', [runId])).rowCount
          )
            valid = false;
        }
        let snapshot: SubscriptionSnapshot | null = null;
        if (valid && payment.stripeSubscriptionId) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `subscription:${payment.stripeSubscriptionId}`,
          ]);
          snapshot = await deps.subscription(payment.stripeSubscriptionId);
          valid =
            snapshot.customerId === payment.stripeCustomerId &&
            (!snapshot.organizationId || snapshot.organizationId === payment.organizationId) &&
            (!snapshot.vendorId || snapshot.vendorId === payment.vendorId);
          if (
            (
              await client.query('SELECT id FROM billing_orders WHERE stripe_subscription_id=$1', [
                payment.stripeSubscriptionId,
              ])
            ).rowCount
          )
            valid = false;
        }
        if (!valid) outcome = 'binding_mismatch';
        else {
          if (!runId) {
            runId = (
              await client.query(
                "INSERT INTO runs (vendor_id,organization_id,tier,status,sla_hours) VALUES ($1,$2,$3,'draft',$4) RETURNING id",
                [
                  payment.vendorId,
                  payment.organizationId,
                  payment.tier,
                  getEntitlements(payment.tier).slaHours,
                ],
              )
            ).rows[0].id;
          }
          // Checkout payment proves initial payment, but cannot prove a later renewal.
          const paidUntil = snapshot?.paidUntil ?? null;
          const status = snapshot
            ? snapshot.status === 'active' && paidUntil && paidUntil > new Date()
              ? 'paid'
              : 'inactive'
            : 'paid';
          await client.query(
            'INSERT INTO billing_orders (organization_id,vendor_id,run_id,tier,stripe_session_id,stripe_payment_intent,stripe_customer_id,stripe_subscription_id,status,amount_total,currency,subscription_status,paid_until,cancel_at_period_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [
              payment.organizationId,
              payment.vendorId,
              runId,
              payment.tier,
              payment.stripeSessionId,
              payment.stripePaymentIntent,
              payment.stripeCustomerId,
              payment.stripeSubscriptionId,
              status,
              payment.amountTotal,
              payment.currency,
              snapshot?.status ?? null,
              paidUntil,
              snapshot?.cancelAtPeriodEnd ?? false,
            ],
          );
          await client.query(
            'UPDATE organizations SET stripe_customer_id=$2,updated_at=now() WHERE id=$1 AND stripe_customer_id IS NULL',
            [payment.organizationId, payment.stripeCustomerId],
          );
          if (status === 'paid')
            await client.query(
              "UPDATE runs SET stripe_payment_intent=$2,status='queued',sla_hours=$3,started_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$4 AND vendor_id=$5 AND tier=$6 AND status='draft'",
              [
                runId,
                payment.stripePaymentIntent,
                getEntitlements(payment.tier).slaHours,
                payment.organizationId,
                payment.vendorId,
                payment.tier,
              ],
            );
          outcome = status === 'paid' ? 'paid' : 'subscription_inactive';
        }
      }
    } else {
      const subscriptionId = subscriptionIdForEvent(event);
      if (subscriptionId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `subscription:${subscriptionId}`,
        ]);
        // An early lifecycle event needs no orphan mapping: Checkout fetches current state later.
        const known = await client.query(
          'SELECT id FROM billing_orders WHERE stripe_subscription_id=$1',
          [subscriptionId],
        );
        if (known.rowCount) {
          const snapshot = await deps.subscription(subscriptionId);
          outcome = (await updateSubscription(client, snapshot))
            ? 'subscription_updated'
            : 'binding_mismatch';
        }
      }
    }
    await client.query('UPDATE billing_events SET outcome=$2 WHERE stripe_event_id=$1', [
      event.id,
      outcome,
    ]);
    await client.query('COMMIT');
    return {
      acted: ['paid', 'subscription_inactive', 'subscription_updated', 'one_off_refunded'].includes(
        outcome,
      ),
      outcome,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
