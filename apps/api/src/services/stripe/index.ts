/**
 * Stripe service.
 *
 * - Checkout session creation for Starter (one-off) and Pro (one-off with
 *   intro price) / Enterprise (quarterly).
 * - Webhook signature verification (uses the raw body captured in
 *   `routes/webhooks.ts`).
 * - Event dispatch — maps Stripe events to application-level effects.
 */

import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { z } from 'zod';

import type { Tier } from '@partnerscope/core';
import { env } from '../../config/env.js';
import { db, pool } from '../../db/client.js';
import { organizations } from '../../db/schema.js';

// ────────────────────────────────────────────────────────────────
// Client (lazy — so env var can be absent in dev/tests)
// ────────────────────────────────────────────────────────────────

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }
  _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    typescript: true,
    timeout: 10_000,
    maxNetworkRetries: 1,
    // Pin to the library's default API version — Stripe auto-upgrades the
    // account if omitted, which is what we want; do not hard-code.
  });
  return _stripe;
}

// ────────────────────────────────────────────────────────────────
// Price resolution
// ────────────────────────────────────────────────────────────────

export interface CheckoutInput {
  tier: Tier;
  /** Buyer org — populated from auth plugin before calling. */
  organizationId: string;
  /** Vendor under assessment — stamped on session.metadata for the webhook. */
  vendorId: string;
  /** Email the Checkout session pre-fills + sends the receipt to. */
  buyerEmail: string;
  /** Optional: carry a pre-existing draft run through the flow. */
  runId?: string;
  /** Override the success URL (adds ?session_id={CHECKOUT_SESSION_ID}). */
  successUrl?: string;
  cancelUrl?: string;
}

export function priceIdForTier(tier: Tier): string {
  switch (tier) {
    case 'starter':
      if (!env.STRIPE_PRICE_STARTER) throw new Error('STRIPE_PRICE_STARTER not set.');
      return env.STRIPE_PRICE_STARTER;
    case 'pro':
      // Today: intro price. Switched to full via config change on 2026-07-01.
      if (!env.STRIPE_PRICE_PRO_INTRO) throw new Error('STRIPE_PRICE_PRO_INTRO not set.');
      return env.STRIPE_PRICE_PRO_INTRO;
    case 'enterprise':
      if (!env.STRIPE_PRICE_ENTERPRISE) throw new Error('STRIPE_PRICE_ENTERPRISE not set.');
      return env.STRIPE_PRICE_ENTERPRISE;
    case 'free_snapshot':
      throw new Error('Free Snapshot does not require checkout.');
  }
}

function modeForTier(tier: Tier): 'payment' | 'subscription' {
  return tier === 'enterprise' ? 'subscription' : 'payment';
}

// ────────────────────────────────────────────────────────────────
// Checkout
// ────────────────────────────────────────────────────────────────

export function checkoutRedirect(raw: string | undefined, kind: 'success' | 'cancel'): string {
  const fallback = kind === 'success' ? env.STRIPE_SUCCESS_URL : env.STRIPE_CANCEL_URL;
  const url = new URL(raw ?? fallback);
  const origin = new URL(env.APP_PUBLIC_URL).origin;
  const allowed =
    kind === 'success'
      ? ['/checkout/success', '/de/checkout/success']
      : ['/checkout/cancelled', '/de/checkout/cancelled', '/plans', '/de/plans'];
  if (url.origin !== origin || url.username || url.password || !allowed.includes(url.pathname))
    throw new Error('invalid_checkout_redirect');
  url.hash = '';
  // Arbitrary redirect/query parameters do not cross the payment boundary.
  url.search = '';
  if (kind === 'success') return `${url.href}?session_id={CHECKOUT_SESSION_ID}`;
  return url.href;
}

export async function createCheckoutSession(
  input: CheckoutInput,
): Promise<{ id: string; url: string | null }> {
  const stripe = getStripe();
  const price = priceIdForTier(input.tier);
  const successUrl = checkoutRedirect(input.successUrl, 'success');
  const cancelUrl = checkoutRedirect(input.cancelUrl, 'cancel');
  const org = (
    await pool.query('SELECT stripe_customer_id FROM organizations WHERE id=$1', [
      input.organizationId,
    ])
  ).rows[0];
  if (!org) throw new Error('billing_organization_missing');
  let customerId: string | null = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        email: input.buyerEmail,
        metadata: { organizationId: input.organizationId },
      },
      { idempotencyKey: `partnerscope-customer-${input.organizationId}` },
    );
    const updated = await pool.query(
      'UPDATE organizations SET stripe_customer_id=$2, updated_at=now() WHERE id=$1 AND (stripe_customer_id IS NULL OR stripe_customer_id=$2) RETURNING stripe_customer_id',
      [input.organizationId, customer.id],
    );
    if (!updated.rowCount) throw new Error('billing_customer_mismatch');
    customerId = customer.id;
  }
  const metadata = {
    tier: input.tier,
    organizationId: input.organizationId,
    vendorId: input.vendorId,
    ...(input.runId ? { runId: input.runId } : {}),
  };
  const session = await stripe.checkout.sessions.create(
    {
      mode: modeForTier(input.tier),
      line_items: [{ price, quantity: 1 }],
      customer: customerId,
      customer_update: { address: 'auto' },
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: input.organizationId,
      metadata,
      ...(input.tier === 'enterprise' ? { subscription_data: { metadata } } : {}),
      billing_address_collection: 'required',
      automatic_tax: { enabled: true },
    },
    input.runId ? { idempotencyKey: `partnerscope-checkout-${input.runId}` } : undefined,
  );
  return { id: session.id, url: session.url };
}

// ────────────────────────────────────────────────────────────────
// Webhook signature verification
// ────────────────────────────────────────────────────────────────

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
}

// ────────────────────────────────────────────────────────────────
// Event → app-level action
// ────────────────────────────────────────────────────────────────

export const paidTierSchema = z.enum(['starter', 'pro', 'enterprise']);
export type PaidTier = z.infer<typeof paidTierSchema>;
const paymentMetadata = z.object({
  tier: paidTierSchema,
  organizationId: z.string().uuid(),
  vendorId: z.string().uuid(),
  runId: z.string().uuid().optional(),
});
export interface PaymentSucceededPayload {
  tier: PaidTier;
  organizationId: string;
  vendorId: string;
  runId?: string;
  stripeSessionId: string;
  stripePaymentIntent: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  buyerEmail: string | null;
  amountTotal: number;
  currency: string;
}
function objectId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

/** Only paid, correctly typed Checkout sessions can grant a service entitlement. */
export function parseCheckoutCompleted(event: Stripe.Event): PaymentSucceededPayload | null {
  if (
    !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)
  )
    return null;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== 'paid') return null;
  const metadata = paymentMetadata.safeParse({
    ...session.metadata,
    organizationId: session.metadata?.organizationId ?? session.client_reference_id,
  });
  if (!metadata.success || !session.id?.startsWith('cs_')) return null;
  const md = metadata.data;
  if (session.client_reference_id && session.client_reference_id !== md.organizationId) return null;
  if (session.mode !== (md.tier === 'enterprise' ? 'subscription' : 'payment')) return null;
  if (
    !Number.isSafeInteger(session.amount_total) ||
    (session.amount_total ?? -1) < 0 ||
    !/^[a-z]{3}$/.test(session.currency ?? '')
  )
    return null;
  const subscriptionId = objectId(session.subscription);
  const customerId = objectId(session.customer);
  if (md.tier === 'enterprise' && (!subscriptionId || !customerId)) return null;
  return {
    ...md,
    stripeSessionId: session.id,
    stripePaymentIntent: objectId(session.payment_intent),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    buyerEmail: session.customer_details?.email ?? session.customer_email ?? null,
    amountTotal: session.amount_total as number,
    currency: session.currency as string,
  };
}

export interface SubscriptionSnapshot {
  id: string;
  customerId: string;
  status: Stripe.Subscription.Status;
  currentPeriodEnd: Date;
  paidUntil: Date | null;
  cancelAtPeriodEnd: boolean;
  organizationId: string | null;
  vendorId: string | null;
}

/** Retrieve current authoritative state, so delayed webhook payloads cannot resurrect access. */
export async function retrieveSubscriptionSnapshot(id: string): Promise<SubscriptionSnapshot> {
  const sub = await getStripe().subscriptions.retrieve(id, { expand: ['latest_invoice'] });
  const invoice = typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
  return {
    id: sub.id,
    customerId: objectId(sub.customer) ?? '',
    status: sub.status,
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    paidUntil: invoice?.paid ? new Date(sub.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    organizationId: sub.metadata.organizationId ?? null,
    vendorId: sub.metadata.vendorId ?? null,
  };
}

/** Prices are identified using configured Stripe Price IDs, never guessed from total amounts. */
export async function verifyCheckoutPrice(payload: PaymentSucceededPayload): Promise<boolean> {
  const lines = await getStripe().checkout.sessions.listLineItems(payload.stripeSessionId, {
    limit: 2,
  });
  return (
    !lines.has_more &&
    lines.data.length === 1 &&
    lines.data[0]?.quantity === 1 &&
    lines.data[0]?.price?.id === priceIdForTier(payload.tier)
  );
}

export function subscriptionIdForEvent(event: Stripe.Event): string | null {
  if (
    [
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.created',
    ].includes(event.type)
  )
    return (event.data.object as Stripe.Subscription).id;
  if (['invoice.paid', 'invoice.payment_failed'].includes(event.type))
    return objectId((event.data.object as Stripe.Invoice).subscription);
  return null;
}

// ────────────────────────────────────────────────────────────────
// Subscription cancellation (for account deletion — Apple 5.1.1(v))
// ────────────────────────────────────────────────────────────────

/**
 * Cancel every billable Stripe subscription attached to an organization.
 *
 * Called by DELETE /v1/auth/me so users exercising their right-to-erasure
 * don't keep getting charged. Per-subscription errors are logged and
 * swallowed — the caller must be able to delete the user row even if
 * Stripe is unreachable (privacy > billing hygiene; ops reconciles via
 * the Stripe dashboard).
 *
 * Returns the count of subscriptions we successfully cancelled.
 */
export async function cancelOrgSubscriptions(
  orgId: string,
): Promise<{ cancelled: number; errors: number }> {
  // If Stripe isn't configured in this environment (local dev, preview) we
  // no-op rather than throw — account deletion must still work.
  if (!env.STRIPE_SECRET_KEY) {
    return { cancelled: 0, errors: 0 };
  }

  const rows = await db
    .select({ customerId: organizations.stripeCustomerId })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const customerId = rows[0]?.customerId;
  if (!customerId) {
    return { cancelled: 0, errors: 0 };
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    console.error('[stripe.cancelOrgSubscriptions] getStripe() failed:', err);
    return { cancelled: 0, errors: 1 };
  }

  const cancellableStatuses = new Set<Stripe.Subscription.Status>([
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'paused',
  ]);

  let cancelled = 0;
  let errors = 0;

  try {
    const listing = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    });
    for (const sub of listing.data) {
      if (!cancellableStatuses.has(sub.status)) continue;
      try {
        await stripe.subscriptions.cancel(sub.id);
        cancelled += 1;
      } catch (subErr) {
        errors += 1;
        console.error(
          `[stripe.cancelOrgSubscriptions] cancel(${sub.id}) failed for org ${orgId}:`,
          subErr,
        );
      }
    }
  } catch (listErr) {
    errors += 1;
    console.error(`[stripe.cancelOrgSubscriptions] list(customer=${customerId}) failed:`, listErr);
  }

  return { cancelled, errors };
}
