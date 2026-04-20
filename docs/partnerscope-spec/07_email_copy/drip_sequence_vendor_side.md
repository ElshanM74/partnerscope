# Vendor-Side Drip Sequence

Version: 1.0 · Last updated: 2026-04-20

Audience: SaaS / AI vendors who received a PartnerScope buyer-initiated assessment request. Goal: get them to complete questionnaire + upload documents within SLA.

Sender: assessments@partnerscope.eu (noreply for transactional; replies monitored)

---

## VEN-1 · T+0h · Welcome + portal invite (transactional)

**Subject:** "{{buyer_company}} requested a PartnerScope assessment of {{vendor_company}}"

**Body:**
```
Hello {{vendor_contact_name}},

{{buyer_company}} has initiated a due-diligence assessment of {{vendor_company}}
using PartnerScope. This is a standard third-party risk process — no cost to
{{vendor_company}}.

You have 48 hours to complete:

  1. Questionnaire — ~25 minutes
  2. Document uploads — see checklist in the portal

Portal link (expires in 7 days):
{{portal_signed_url}}

What happens next:
  · We verify your evidence against registries and automated checks
  · You get to review findings before the buyer
  · Buyer receives a time-boxed, confidential report

Questions? Reply to this email.

— PartnerScope Assessments Team
```

---

## VEN-2 · T+24h · Gentle reminder (if incomplete)

**Subject:** "Reminder — {{vendor_company}} assessment due in 24 hours"

**Body:**
```
Hello {{vendor_contact_name}},

Quick reminder: the PartnerScope assessment requested by {{buyer_company}}
is due in 24 hours. You're {{percent_complete}}% complete.

Most common items still missing:
  {{missing_items_bulleted}}

Pick up where you left off:
{{portal_signed_url}}

If {{buyer_company}} is a priority account, completing on time avoids the
"insufficient evidence" rating on the dimensions you haven't answered.

— PartnerScope
```

---

## VEN-3 · T+46h · SLA warning (if incomplete)

**Subject:** "Action needed: assessment closes in 2 hours"

**Body:**
```
Hello {{vendor_contact_name}},

The questionnaire window for {{buyer_company}} closes in approximately 2 hours.
Unanswered items will be scored as "insufficient evidence" and the final report
will reflect that.

Complete now:
{{portal_signed_url}}

If you need an extension, reply with the reason and we'll relay to
{{buyer_company}}.

— PartnerScope
```

---

## VEN-4 · T+7d · Right-of-reply (after report draft)

**Subject:** "{{vendor_company}}: review your findings before buyer delivery"

**Body:**
```
Hello {{vendor_contact_name}},

Your PartnerScope assessment is drafted. Before it's delivered to
{{buyer_company}}, you have 5 business days to review and dispute findings.

Report draft + dispute form:
{{draft_signed_url}}

What you can do:
  · Request correction of a factual error with evidence
  · Request redaction of commercial-confidence items
  · Accept as-is (one-click)

Silence = acceptance after 5 business days.

— PartnerScope
```

---

## VEN-5 · Optional · Remediation offer

**Subject:** "Would you like a remediation roadmap?"

Sent only if findings include ≥ 3 mediums or 1 high, and vendor engages.

```
Hello {{vendor_contact_name}},

Based on your PartnerScope assessment, we offer an optional remediation
roadmap — a structured 30/60/90-day plan with sample documents for the gaps
we identified. Completing it means your next buyer request gets a better
score.

Included free with any Pro-tier report. If you'd like the roadmap, reply
"yes" and we'll send it within 24h.

— PartnerScope
```

---

## Template variables (from DB)

```
{{vendor_contact_name}}     responses.respondent_name
{{vendor_company}}          vendors.legal_name
{{buyer_company}}           organizations.legal_name
{{portal_signed_url}}       Signed S3+Cloudfront URL, 7d TTL
{{percent_complete}}        responses COUNT / questions(tier) * 100
{{missing_items_bulleted}}  questions WHERE tier_gate=run.tier LEFT JOIN responses WHERE NULL
{{draft_signed_url}}        Draft PDF URL, 5 business days TTL
```

## Tone & compliance

- No marketing upsell to vendor (they're not our customer in this flow)
- Transactional classification → no double opt-in required
- GDPR Art. 14 notice on first email (privacy policy link)
- All portal actions logged to `audit_log`
