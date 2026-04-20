# Stripe Products & Prices

Version: 1.0 · Last updated: 2026-04-20

All EUR, tax-exclusive. Automatic tax enabled. Invoices include VAT where applicable (DE/AT/CH reverse charge configured).

## Products (to create in Stripe dashboard or via API)

### 1. PartnerScope Starter — one-time
- Product ID: `prod_partnerscope_starter`
- Description: "Single vendor snapshot report · 24h SLA · automated testing"
- Default price: `price_starter_99`
  - Amount: 9900 cents (€99)
  - Currency: EUR
  - One-time

### 2. PartnerScope Pro — one-time (launch price €299, list €499)
- Product ID: `prod_partnerscope_pro`
- Description: "Full 78-question analysis + documentary review + 5 red-team payloads · 48h SLA"
- Prices:
  - `price_pro_499` — 49900 cents (list)
  - `price_pro_299_intro` — 29900 cents (intro; expires 2026-06-30)
- Metadata: `{ "intro_expires": "2026-06-30" }`

### 3. PartnerScope Pro Refresh — add-on
- Product ID: `prod_partnerscope_pro_refresh`
- Description: "Quarterly refresh for existing Pro vendor"
- Price: `price_pro_refresh_199` — 19900 cents

### 4. PartnerScope Enterprise — recurring quarterly
- Product ID: `prod_partnerscope_enterprise`
- Description: "Continuous monitoring · 15-vendor portfolio · dedicated analyst · SSO"
- Price: `price_enterprise_4900_qtr`
  - Amount: 490000 cents
  - Interval: quarter (3 months)
  - Min units: 1
  - Metered additional vendors: `price_enterprise_addvendor_199_qtr` — 19900 cents/vendor/qtr

### 5. PartnerScope Enterprise Onboarding — one-time
- Product ID: `prod_partnerscope_enterprise_onboarding`
- Description: "One-time onboarding, SSO setup, integration mapping"
- Price: `price_enterprise_onboarding_2500` — 250000 cents

## Coupons

- `LAUNCH2026` — 40% off first Pro purchase, expires 2026-06-30
- `DACH-CISO` — 25% off first Enterprise quarter, max redemptions 20

## Webhook events to handle

| Event | Handler | Action |
|-------|---------|--------|
| `checkout.session.completed` | `stripe_webhook.handle_checkout` | Create Run row with tier, trigger orchestrator |
| `invoice.paid` | `stripe_webhook.handle_invoice_paid` | Mark subscription active, create quarterly monitoring plan |
| `invoice.payment_failed` | `handle_payment_failed` | Pause monitoring, email billing contact |
| `customer.subscription.deleted` | `handle_sub_cancel` | End continuous monitoring at period end |
| `charge.refunded` | `handle_refund` | Mark run as `cancelled`, revoke PDF access |

## Testing

- Stripe test mode API key in env `STRIPE_SECRET_KEY_TEST`
- Test card: `4242 4242 4242 4242`, exp any future, CVC any
- Webhook CLI: `stripe listen --forward-to localhost:8000/webhooks/stripe`

## Compliance

- PCI SAQ A (Stripe Elements used; no card data touches our servers)
- VAT: Reverse charge for B2B EU outside DE; DE 19% for domestic; AT 20% for AT customers; CH 7.7% for CH
- Invoice fields: legal entity "EKM Global Consulting GmbH", USt-IdNr, address
