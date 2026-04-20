# CTA Ladder — progressive commitment from visitor to Enterprise

Version: 1.0 · Last updated: 2026-04-20

Goal: move every visitor one rung up. No "contact sales" dead-ends.

---

## Ladder

| Rung | Commitment | CTA label | Destination | Friction |
|------|------------|-----------|-------------|----------|
| 0 | Read | — | — | None |
| 1 | Email | "Download sample Pro report" | `/resources/sample-report` (form) | 1 field (email) |
| 2 | 60-second snapshot | "Score a vendor now — free" | `/plans#snapshot` (5-question form) | 3 fields, no account |
| 3 | Starter | "Start a €99 snapshot" | `/checkout?tier=starter` | Stripe Checkout |
| 4 | Pro | "Start a Pro assessment" | `/checkout?tier=pro` | Stripe Checkout |
| 5 | Demo | "Book 15-min demo" | `/demo` (Cal.com) | Calendar pick |
| 6 | Enterprise | "Book Enterprise call" | `/enterprise-intro` (Cal.com + form) | Scoping form |

---

## Placement rules

- **Every page:** sticky footer with rung 2 ("Free snapshot") + rung 5 ("Book demo")
- **Homepage hero:** rung 2 primary, rung 4 secondary
- **Pricing page:** rung 3, 4, 6 as tier-card primaries; rung 1 + 2 as above-fold alternatives
- **Blog posts:** end-of-post CTA = rung 1 (email capture) + rung 2
- **Demo report page:** after the sample ends, rung 3 + rung 4

## Dynamic nudges

| Trigger | Action |
|---------|--------|
| Scroll depth > 60% on pricing page | Show rung 2 slide-in |
| Time on site > 90s without click | Show rung 1 banner |
| Returning visitor (cookie) | Swap rung 2 primary for rung 3 |
| UTM = paid search | Default primary = rung 3 |
| UTM = LinkedIn outbound | Default primary = rung 5 |

## Funnel KPIs (track in Mixpanel / GA4)

| Step | Target conv. rate |
|------|-------------------|
| Visit → Snapshot submit | 4-8% |
| Snapshot → Starter | 6-10% |
| Starter → Pro | 15-25% (90-day window) |
| Demo → Enterprise | 20-30% |

## Anti-pattern list (do NOT do)

- "Contact us" as only CTA for any tier (blocker — replaced with self-serve checkout for Starter/Pro)
- Popup on first load (tested poorly in DACH — hurts trust)
- Gated pricing — pricing is fully visible
- Hidden Enterprise price range — we show €4 900/qtr explicitly
