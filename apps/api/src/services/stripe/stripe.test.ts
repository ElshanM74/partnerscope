/**
 * Webhook signature verification tests.
 *
 * These run without network access: we construct a Stripe signature header
 * manually using the library's test helper, then run it through our
 * `verifyWebhookSignature` → `parseCheckoutCompleted` pipeline.
 */

import Stripe from 'stripe';
import { beforeAll, describe, expect, it } from 'vitest';

// Set env BEFORE importing the module (env.ts is a top-level import with
// side effects — the Zod-validated config locks once loaded).
process.env.DATABASE_URL ??= 'postgres://localhost:5432/partnerscope_test';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy_key_for_unit_tests_only';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy_secret_for_unit_tests_only';
process.env.STRIPE_PRICE_STARTER ??= 'price_starter_dummy';

import { parseCheckoutCompleted, verifyWebhookSignature } from './index.js';

const STRIPE = new Stripe('sk_test_unit', { typescript: true });

function buildSignature(payload: string, secret: string): string {
  // Stripe's library exposes generateTestHeaderString specifically for this.
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

describe('Stripe webhook signature verification', () => {
  const secret = 'whsec_dummy_secret_for_unit_tests_only';

  beforeAll(() => {
    // Ensure the lazy Stripe client sees the same secret the signature uses.
    process.env.STRIPE_WEBHOOK_SECRET = secret;
  });

  it('rejects a tampered body', () => {
    const good = JSON.stringify({ id: 'evt_1', type: 'ping' });
    const header = buildSignature(good, secret);
    const tampered = Buffer.from(good.replace('ping', 'pong'));
    expect(() => verifyWebhookSignature(tampered, header)).toThrow();
  });

  it('accepts a valid checkout.session.completed event', () => {
    const raw = JSON.stringify({
      id: 'evt_test_123',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_abc',
          object: 'checkout.session',
          payment_status: 'paid',
          payment_intent: 'pi_test_xyz',
          amount_total: 9900,
          currency: 'eur',
          client_reference_id: '00000000-0000-0000-0000-000000000001',
          customer_email: 'buyer@acme.test',
          customer_details: { email: 'buyer@acme.test' },
          metadata: {
            tier: 'starter',
            organizationId: '00000000-0000-0000-0000-000000000001',
            vendorId: '00000000-0000-0000-0000-000000000002',
            runId: '00000000-0000-0000-0000-000000000003',
          },
        },
      },
    });
    const header = buildSignature(raw, secret);

    const event = verifyWebhookSignature(Buffer.from(raw), header);
    expect(event.type).toBe('checkout.session.completed');

    const payload = parseCheckoutCompleted(event);
    expect(payload).not.toBeNull();
    expect(payload?.tier).toBe('starter');
    expect(payload?.organizationId).toBe('00000000-0000-0000-0000-000000000001');
    expect(payload?.vendorId).toBe('00000000-0000-0000-0000-000000000002');
    expect(payload?.runId).toBe('00000000-0000-0000-0000-000000000003');
    expect(payload?.stripePaymentIntent).toBe('pi_test_xyz');
    expect(payload?.amountTotal).toBe(9900);
  });

  it('skips events that are not paid checkout sessions', () => {
    const rawEvent: Stripe.Event = {
      id: 'evt_test_other',
      object: 'event',
      api_version: '2024-10-28.acacia',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
      type: 'payment_intent.succeeded',
      data: {
        // Technically a PI, but parseCheckoutCompleted only looks at
        // checkout.session.completed — it should short-circuit anyway.
        object: {} as unknown as Stripe.PaymentIntent,
      },
    };
    expect(parseCheckoutCompleted(rawEvent)).toBeNull();
  });

  it('skips events missing required metadata', () => {
    const rawEvent: Stripe.Event = {
      id: 'evt_test_bad_md',
      object: 'event',
      api_version: '2024-10-28.acacia',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_nomd',
          object: 'checkout.session',
          payment_status: 'paid',
          metadata: {},
        } as unknown as Stripe.Checkout.Session,
      },
    };
    expect(parseCheckoutCompleted(rawEvent)).toBeNull();
  });
});

// Silence an unused-import lint by touching the Stripe instance.
void STRIPE;
