# Transactional Emails

Version: 1.0 · Last updated: 2026-04-20

System-generated, non-marketing. Sent via Postmark (transactional stream) with DKIM/SPF/DMARC aligned to partnerscope.eu.

---

## TX-01 · Payment confirmed

**Trigger:** `stripe.webhook.invoice.paid`  
**From:** billing@partnerscope.eu  
**Subject:** "Payment received — PartnerScope {{tier_name}} · Report {{report_id}}"

```
Hello {{buyer_name}},

Thank you. Payment of €{{amount}} for a {{tier_name}} assessment has been
received. Invoice attached.

What happens next:
  · Our automated layer is already running against {{vendor_domain}}
  · Expected delivery: {{sla_delivery_at}}
  · You'll receive the report PDF + dashboard link by email

Track status: {{run_status_url}}

Questions? Reply to this email.

— PartnerScope
```

Attachment: Invoice PDF (Stripe).

---

## TX-02 · Report ready

**Trigger:** `run.status → delivered`  
**Subject:** "Your PartnerScope report is ready — {{vendor_legal_name}}"

```
Hello {{buyer_name}},

Your {{tier_name}} assessment for {{vendor_legal_name}} is complete.

Composite score: {{composite_score}} / 100 · Band: {{risk_band}}
{% if hard_red_flag %}⚠ Hard red flag identified — see page 5 of the report.{% endif %}

Download PDF (signed URL, valid 72h):
{{report_pdf_url}}

Dashboard view:
{{dashboard_url}}

Evidence repository (7-year retention):
{{evidence_repo_url}}

Valid until {{valid_until}}. Request a refresh anytime.

— PartnerScope Analyst Team
```

---

## TX-03 · Free snapshot delivered

**Trigger:** `POST /demo/submit` success  
**Subject:** "Your 60-second snapshot for {{vendor_domain}}"

```
Hi,

Your free snapshot for {{vendor_domain}}:

Score: {{snapshot_score}} / 100 · Band: {{risk_band}}
Top concerns:
  1. {{concern_1}}
  2. {{concern_2}}
  3. {{concern_3}}

Want the full picture?
  · Starter (€99) — 24h · automated tests + questionnaire
  · Pro (€299 intro / €499) — 48h · documentary review + red-team

Upgrade: {{upgrade_url}}

— PartnerScope
```

---

## TX-04 · Monitoring alert (Enterprise)

**Trigger:** `monitoring_signal.severity ≥ high`  
**Subject:** "⚠ {{signal_code}} detected on {{vendor_legal_name}}"

```
Hello {{contact_name}},

A high-severity monitoring signal was detected on {{vendor_legal_name}}.

Signal: {{signal_code}}
Severity: {{severity}}
Detected: {{detected_at}}
Details: {{payload_summary}}

Recommended action: {{recommended_action}}

View in dashboard: {{signal_url}}
Acknowledge: {{ack_url}}

— PartnerScope Monitoring
```

---

## TX-05 · Password reset

Standard reset flow, 15-min TTL token, signed URL, audit-logged.

---

## TX-06 · SSO setup complete

**Subject:** "SSO configured for {{org_name}}"

Sent to admins when SAML / OIDC IdP metadata accepted. Lists test account + next-step checklist.

---

## TX-07 · Invoice reminder (dunning)

**Trigger:** Stripe `invoice.payment_failed` + retries  
**Cadence:** Day 1, Day 5, Day 10 · final notice Day 14 with pause notice.

---

## Tech notes

- All transactional emails use Postmark `MessageStream=transactional-prod`
- HTML + plain-text multipart; plain-text is canonical
- List-Unsubscribe header present only for optional (non-transactional) messages
- Message-ID format: `<{{uuid}}@partnerscope.eu>`
- Reply-To: for buyer-facing = reports@partnerscope.eu; for vendor-facing = assessments@partnerscope.eu; for billing = billing@partnerscope.eu
- All emails rendered from Jinja2 templates in `templates/emails/` (Claude Code impl detail)
