# Buyer-Side Drip Sequence

Version: 1.0 · Last updated: 2026-04-20

Audience: CISO / Chief Compliance / Head of Vendor Risk / Head of Procurement / Head of AI Governance at DACH (DE/AT/CH) + Azerbaijan mid-market to enterprise organizations.

Sender: Elshan Musayev <elshan.musayev@partnerscope.eu>  
Sending infra: Google Workspace, SPF/DKIM/DMARC configured (see `B2B_Outreach/` scripts)  
Cadence: 7 emails over 21 days, business days only (Tue-Thu preferred, 10:00-11:30 CET)  
Stop conditions: reply, click on pricing, unsubscribe, bounced

---

## Email 1 · Day 0 · Cold intro (problem framing)

**Subject A/B:**
- A: "AI Act deadline is closer than your vendor list"
- B: "Third-party AI risk, but without the 40-page questionnaire"

**Body:**
```
Hi {{first_name}},

{{company}} likely has 30-200 AI-touching vendors today. Under EU AI Act Art. 10
and DORA Art. 28, you need to show regulators which ones are high-risk —
within weeks, not months, once the deployer obligations bite.

Most teams answer this with spreadsheets + 40-page questionnaires that vendors
half-fill. PartnerScope runs the same assessment in 48 hours with documentary
review, automated checks (sanctions, breaches, SBOM), and 5 AI red-team payloads
per vendor. Report is drop-in for your ISMS.

€499 per vendor (intro €299 until end of June). €99 snapshot to try.

Want a 15-minute demo this week?

— Elshan
EKM Global Consulting GmbH · partnerscope.eu
```

---

## Email 2 · Day 3 · Social proof + case fragment

**Subject:** "DataFlow GmbH: 5 concerns we flagged in 48h"

**Body:**
```
Hi {{first_name}},

One quick example — a DACH SaaS vendor we assessed last week. Top 5 findings
our automated layer caught before the vendor even answered questionnaire:

1. TLS downgrade on admin portal (exposed to browser warnings)
2. Transparenzregister UBO mismatch with vendor's declared owners
3. HuggingFace Model Card missing `out_of_scope_use` and `ethical_considerations`
4. DPA clause 7 assigned all liability back to the buyer (unusual)
5. Indirect prompt-injection vulnerability in PDF ingestion pipeline

Full report is 24 pages. Available as a demo PDF if useful.

Would the demo help your next vendor review?

— Elshan
```

CTA button: "Send me the demo report"

---

## Email 3 · Day 6 · Regulatory urgency

**Subject:** "15-day incident window starts August — is your vendor mapped?"

**Body:**
```
Hi {{first_name}},

Short one. EU AI Act Art. 73 requires notification of serious AI incidents
within 15 days. For deployers, that only works if your vendors have:

  · An incident reporting SOP aligned to Art. 73
  · A named internal owner
  · A test of the workflow in the last 12 months

Our Pro assessment checks all three in writing, with evidence stored under
object-lock for audit.

Worth a 15 minutes? I can screen-share three live vendor assessments.

— Elshan
```

---

## Email 4 · Day 10 · Free snapshot offer

**Subject:** "60-second snapshot on your riskiest vendor — free"

**Body:**
```
Hi {{first_name}},

If full assessments feel like too much to justify right now, try the free
snapshot: 5 questions, no account, gives you:

  · Composite risk score 0-100
  · Top 3 concerns
  · Upgrade path if you want depth

Link: partnerscope.eu/plans#snapshot

Takes less time than reading this email.

— Elshan
```

---

## Email 5 · Day 14 · Objection handling

**Subject:** "Three things teams usually ask before signing"

**Body:**
```
Hi {{first_name}},

Most teams I speak with ask the same three things. Short answers:

1. "Do you replace our existing GRC tool?"
   No. We plug into ServiceNow, Archer, OneTrust as a data source, not a
   replacement. Findings are exportable JSON/CSV/Parquet.

2. "Who stands behind the findings?"
   Our analysts are named on every report, reviewed by a QA analyst. Reports
   are time-stamped and signed. You can dispute findings within 15 days.

3. "How fresh is the data?"
   Starter/Pro reports valid 90-180 days. Enterprise gets continuous weekly
   polling on 11 signals — breach, sanctions, cert change, UBO change etc.

Which of these matters most for {{company}}?

— Elshan
```

---

## Email 6 · Day 17 · Use-case by persona

Branching by persona — the send script picks the right paragraph based on CRM `persona` field.

**Subject:** "{{persona-specific hook}}"

**Variants:**

*CISO:*
```
AI-specific risks (prompt injection, model drift, SBOM CVEs) rarely sit in
classic third-party tools. Our Pro red-team section gives you CVE-level detail
on the vendor's LLM stack.
```

*CCO:*
```
GDPR Art. 28 DPA review + Art. 30 ROPA extract are in every Pro report. Ready
for DPA audits in your file cabinet.
```

*Head of Procurement:*
```
Contract negotiation gets faster when you walk in with a ranked risk register
— we've seen deal cycles cut by 2-3 weeks.
```

*Head of AI Governance:*
```
Full Annex III classification + obligations gap per vendor. You stop chasing
vendors for conformity assessment status.
```

---

## Email 7 · Day 21 · Soft break-up

**Subject:** "Closing the loop"

**Body:**
```
Hi {{first_name}},

I'll stop emailing unless there's a reason to continue. If you want a 15-min
demo or just the free snapshot, the door stays open:

  · Demo: reply "demo"
  · Free snapshot: partnerscope.eu/plans#snapshot
  · Mute: reply "not now" and I'll revisit in Q4

Thanks for reading this far.

— Elshan
EKM Global Consulting GmbH · partnerscope.eu
```

---

## Metadata / tracking

- UTM: `utm_source=email&utm_medium=drip&utm_campaign=buyer_dach_2026q2`
- CRM field updates: each email logs `last_touch_at`, `last_email_id`
- Reply classification (via `reply_monitor.py`): positive / objection / unsubscribe / OOO
- Unsubscribe: single-click, List-Unsubscribe header per RFC 8058

## Compliance

- Legitimate interest basis (GDPR Art. 6(1)(f)) — B2B, role-based, relevant
- GDPR Art. 21 opt-out honored within 48h
- German TMG §7(2) — business-related content only, clear sender ID, unsubscribe
- Swiss UWG compliance — consent preferred for CH, legitimate interest documented
