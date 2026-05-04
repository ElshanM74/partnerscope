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

import type { Tier } from '@partnerscope/core';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
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

function priceIdForTier(tier: Tier): string {
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

export async function createCheckoutSession(
  input: CheckoutInput,
): Promise<{ id: string; url: string | null }> {
  const stripe = getStripe();
  const price = priceIdForTier(input.tier);

  const session = await stripe.checkout.sessions.create({
    mode: modeForTier(input.tier),
    line_items: [{ price, quantity: 1 }],
    customer_email: input.buyerEmail,
    success_url: `${input.successUrl ?? env.STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl ?? env.STRIPE_CANCEL_URL,
    client_reference_id: input.organizationId,
    metadata: {
      tier: input.tier,
      organizationId: input.organizationId,
      vendorId: input.vendorId,
      ...(input.runId ? { runId: input.runId } : {}),
    },
    billing_address_collection: 'required',
    automatic_tax: { enabled: true },
  });

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

export interface PaymentSucceededPayload {
  tier: Tier;
  organizationId: string;
  vendorId: string;
  runId?: string;
  stripeSessionId: string;
  stripePaymentIntent: string | null;
  buyerEmail: string | null;
  amountTotal: number | null; // cents
  currency: string | null;
}

/**
 * Normalise a `checkout.session.completed` event into the
 * app-level payload we actually care about. Pure — no DB writes.
 */
export function parseCheckoutCompleted(event: Stripe.Event): PaymentSucceededPayload | null {
  if (event.type !== 'checkout.session.completed') return null;
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return null;
  }

  const md = session.metadata ?? {};
  const tier = md.tier as Tier | undefined;
  const organizationId = md.organizationId ?? session.client_reference_id ?? null;
  const vendorId = md.vendorId ?? null;
  if (!tier || !organizationId || !vendorId) return null;

  const pi =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  return {
    tier,
    organizationId,
    vendorId,
    runId: md.runId,
    stripeSessionId: session.id,
    stripePaymentIntent: pi,
    buyerEmail: session.customer_details?.email ?? session.customer_email ?? null,
    amountTotal: session.amount_total,
    currency: session.currency,
  };
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
