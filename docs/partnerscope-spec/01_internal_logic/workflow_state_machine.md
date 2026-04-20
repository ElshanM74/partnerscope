# Report Workflow — State Machine

**Audience:** Engineering.
**Purpose:** Defines every state a report can be in, and what triggers transitions.

---

## States

```
DRAFT → SUBMITTED → PROCESSING → [ANALYST_REVIEW] → READY → DELIVERED → ARCHIVED
                                                          ↘ FAILED
```

| State | Description | Tier | Trigger to next |
|---|---|---|---|
| `DRAFT` | User editing questionnaire | all | user clicks "Submit" |
| `SUBMITTED` | Payment captured, queued | all | Stripe webhook success |
| `PROCESSING` | Automated tests running | all | tests complete or timeout 5min |
| `ANALYST_REVIEW` | Aligned with human reviewer | Pro/Ent | analyst marks "reviewed" |
| `READY` | PDF generated, awaiting email | all | send job picks up |
| `DELIVERED` | Email sent with PDF link | all | user opens report |
| `ARCHIVED` | 90 days after DELIVERED | all | cron job |
| `FAILED` | Any step failed | all | retry 3x then notify ops |

---

## Transitions + side effects

### DRAFT → SUBMITTED
- Validate: all required questions answered (min 90%)
- Create Stripe Checkout Session
- On payment success → `SUBMITTED`
- On payment fail/abandon → stay `DRAFT` (email reminder at T+2h)

### SUBMITTED → PROCESSING
- Kick off automated test workers (see `03_automated_tests/`)
- Send confirmation email: "Your report is being generated"
- Starter: expect 2-5 minutes to complete
- Pro/Ent: expect 10-30 minutes for automated, then queue for analyst

### PROCESSING → ANALYST_REVIEW (Pro/Ent only)
- Auto-assign to next available analyst (round-robin)
- Send Slack alert to #analyst-queue
- SLA clock starts: Pro = 48h, Ent = 24h priority

### PROCESSING → READY (Starter only)
- Skip analyst step
- Generate PDF via template engine
- Upload to S3 with signed URL (7-day expiry for Starter, 90-day for Pro/Ent)

### ANALYST_REVIEW → READY
- Analyst submits verified findings via admin UI
- PDF regenerated with analyst annotations
- Quality gate: composite score validated, red flags confirmed, remediation checklist filled

### READY → DELIVERED
- Email send job runs (SendGrid/Postmark)
- Template: `transactional/report_ready.html`
- Track delivery, opens, downloads in events table

### DELIVERED → ARCHIVED
- Cron at T+90 days
- Move PDF to cold storage
- Keep metadata + score for trend analysis

### * → FAILED
- Log full context to `incidents` table
- Retry policy: 3 attempts with exponential backoff (1min, 5min, 15min)
- After 3 fails: send ops alert, refund if SLA breached, notify customer

---

## Enterprise additional states

Enterprise adds two parallel workflows:

**Vendor Portfolio Workflow:**
```
ADDED → BASELINE_COMPLETE → MONITORED → [DRIFT_DETECTED] → REASSESSED
```

- Every vendor in the portfolio has its own state
- Drift signals (see `03_automated_tests/drift_signals.md`) trigger REASSESSED
- Quarterly cron forces REASSESSED for all vendors

**Dashboard Sync:**
- Every 15 min: pull automated test results
- Every 24h: run sanctions/adverse media re-check
- Every 7 days: recompute portfolio risk heatmap

---

## Event bus (recommend Kafka/Redis Streams)

All state changes emit events. Topics:

- `partnerscope.report.state_changed`
- `partnerscope.test.completed`
- `partnerscope.analyst.assigned`
- `partnerscope.drift.detected`
- `partnerscope.delivery.sent`
- `partnerscope.payment.captured`

Each event has `report_id`, `tier`, `from_state`, `to_state`, `timestamp`, `actor`, `metadata`.

---

## Failure modes & recovery

| Failure | Recovery |
|---|---|
| Stripe webhook timeout | Reconcile via cron every 5 min (poll Stripe for unprocessed events) |
| Automated test API down | Degrade gracefully; mark specific tests as "unavailable" (not "failed") |
| Analyst unavailable | Escalate to backup pool; send Slack alert to #ops-urgent |
| PDF generation fails | Retry 3x; then fallback to HTML report with apology email |
| S3 upload fails | Queue to disk, retry; alert if queue > 10 items |
| Email bounce | Mark delivery failed, retry once; then notify user via in-app |

---

## SLA tracking

Every `SUBMITTED` starts a timer. SLA metric = time from `SUBMITTED` to `DELIVERED`.

Breach thresholds:
- Starter: >30 min = yellow alert; >2h = red + automatic refund offer
- Pro: >48h = yellow; >72h = red + 50% refund
- Enterprise: >24h ad-hoc = yellow; >48h = red + credit to next quarter

Dashboard: `ops.partnerscope.eu/sla` (internal only).
