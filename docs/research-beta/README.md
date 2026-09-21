# PartnerScope research beta — 2026-09-21

New authenticated `/research` screen: supplier discovery or company check, business task/country/criteria, live OpenAI Responses web search, source citations, report history per organization, JSON export/browser print. Existing scoring and synthetic WIP are not used. Native Capacitor shells can reach the same page after login; physical device/store testing is not claimed.

## Configuration and operation

Existing OPENAI_API_KEY, optional RESEARCH_MODEL (default gpt-5.4), local STORAGE_LOCAL_DIR. Files stored atomically under research/<organization UUID>/<report UUID>. Shared organization ownership, no client inputs stored at provider (store:false). Only public business information belongs in prompts. Failed searches create no report; insufficient citations returns422 and asks for better identifiers. Provider call timeout45seconds. Beta protection:5 attempts/org/hour and one active request/org, global4; in-process counters reset on restart, not paid entitlements. Protected routes revalidate JWT user membership against DB to reject deleted accounts.

## Validation

Three live provider cases in scripts/research-smoke.ts; executed using server's existing key without extracting it. Initial gpt-4.1 search conflated company claims with evidence and grouped unrelated companies. Switched to gpt-5.4 and strengthened attribution/single-entity rules; repeated same regression cases:

- Known Azinvest Alat award: completed24.9s; separates press reports of award from unknown completion/team/deadlines. This tests reasoning boundaries; not all report claims independently verified.
- Invented name:11.7s, no usable citations; service rejects report with research_sources_missing. API exposes insufficient_evidence422, not a clean rating or invented portfolio.
- AZ fibre contractor discovery:completed22.6s,3 separate candidate sections, company claims labelled, no numeric score or invented available team. Candidate list is not exhaustive and changes between searches.

Raw outputs recorded in live-smoke-2026-09-21.jsonl. These are developer regression examples, not an independent accuracy benchmark. The app still produces AI interpretation requiring source review; no automated verified-risk verdict is claimed.

Unit/integration regressions cover input validation, source annotations, incomplete provider output, unsafe URLs, real filesystem tenant separation/traversal, deleted-user access, invalid IDs, and real Fastify organization rate limits. Database is a controlled boundary spy in route tests, not a live database test.

Mobile browser layout checked at390px: no horizontal overflow. Installed native binaries not modified. No ad campaign, payment change, customer contact or newsletter sending is part of this release.

Rollback: redeploy previous commit2f5084f. Research files remain private on storage volume; old app has no route to expose them. No SQL migration.
