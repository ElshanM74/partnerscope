# Evidence Requirements per Dimension

Version: 1.0 · Last updated: 2026-04-20  
Owner: PartnerScope Product

For each of the 13 dimensions this document defines:
- **Required artifacts** (what the vendor or auto-test must produce)
- **Acceptance criteria** (what makes the evidence "valid")
- **Fallback** (what happens if evidence is missing)
- **Tier gate** (FS=Free Snapshot, ST=Starter, PR=Pro, EN=Enterprise)

---

## BEHAVIORAL CLUSTER (weight 25)

### D1. Communication Transparency (weight 5)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Response-time log (email thread export) | Median ≤ 48h over 30 days | Score = 40 | PR |
| Escalation policy (PDF) | Named owner + phone + SLA | Score = 50 | PR |
| Public status page URL | HTTP 200, last update ≤ 7d | Score = 60 | ST |

### D2. Contractual Integrity (weight 5)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Signed DPA (PDF) | GDPR Art. 28 clauses present, SCCs if non-EU | Hard red flag | PR |
| MSA / SLA document | Liability cap ≥ 12× monthly fee | Score = 40 | PR |
| Change-management clause | Written notice ≥ 30 days for material changes | Score = 50 | PR |

### D3. Operational Reliability (weight 5)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| 12-month uptime report | ≥ 99.5% (Starter), ≥ 99.9% (Pro/Ent) | Score = 40 | ST |
| Incident post-mortems (last 2) | RCA + remediation + timeline | Score = 50 | PR |
| Runbook / IR plan | Named on-call + contact tree | Score = 60 | PR |

### D4. Responsiveness to Issues (weight 5)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Ticket SLA matrix | P1 ≤ 4h, P2 ≤ 24h | Score = 40 | PR |
| Past 3 incident communications | Client notified ≤ 2h of detection | Score = 50 | PR |

### D5. Cultural & Ethical Alignment (weight 5)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Code of Conduct (PDF) | Covers anti-bribery, anti-discrimination | Score = 50 | PR |
| Whistleblower channel | External, anonymous, EU Dir. 2019/1937 compliant | Score = 60 | PR |
| Sanctions screening attestation | Last run ≤ 90 days | Hard red flag if hit | ST |

---

## FINANCIAL / STRUCTURAL CLUSTER (weight 30)

### D6. Financial Stability (weight 6)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Last 2 fiscal years — audited statements OR filed accounts | Positive equity, no going-concern note | Score = 30 | PR |
| Credit score (D&B, CreditSafe, Bisnode) | ≥ 60/100 | Score = 40 | PR |
| Insolvency register check | Clean | Hard red flag | ST |

### D7. Ownership & Governance (weight 6)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| UBO disclosure (≥ 25%) | Matches official register | Hard red flag on mismatch | PR |
| Board composition | Independent members named | Score = 50 | PR |
| Parent / subsidiary map | Full chain to UBO | Score = 60 | PR |

### D8. Regulatory Licensing (weight 6)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Relevant sector license (e.g. BaFin, FMA, FINMA) | Active, not suspended | Hard red flag if required & missing | PR |
| Professional indemnity insurance | ≥ €5m coverage | Score = 50 | PR |

### D9. Supply-Chain Depth (weight 6)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Sub-processor list | Named, with country + purpose | Score = 40 | PR |
| 4th-party inventory (Enterprise) | Depth ≥ 2 tiers | Score = 50 | EN |
| Concentration risk score | No single sub-processor > 40% of critical flow | Score = 50 | EN |

### D10. Business Continuity (weight 6)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| BCP / DR plan (PDF) | RTO ≤ 24h, RPO ≤ 4h | Score = 40 | PR |
| Last DR drill report | Within last 12 months | Score = 50 | PR |
| Backup policy | 3-2-1, geo-redundant, tested restore | Score = 60 | PR |

---

## AI / COMPLIANCE CLUSTER (weight 45) — triple-weighted per AI Act

### D11. Data Provenance & Integrity (weight 15)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Training-data statement (EU AI Act Art. 10) | Sources, licensing, scraping policy declared | Hard red flag | PR |
| Copyright / IP attestation | No unlicensed scraped content | Cap 65 | PR |
| PII / special-category data handling | GDPR Art. 9 controls documented | Cap 65 | PR |
| Data-lineage diagram | From source → feature store → model | Score = 50 | EN |
| Opt-out / deletion SOP | Demonstrable on request (< 30d) | Score = 60 | PR |

### D12. Model Transparency & Accountability (weight 15)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| Model Card (HuggingFace / NIST format) | Intended use, limitations, metrics, risks | Hard red flag | PR |
| SBOM / MBOM | Machine-readable (CycloneDX or SPDX) | Cap 65 | PR |
| Red-team / eval report | Independent or internal with methodology | Score = 40 | PR |
| Version pinning + change log | Semver + changelog URL | Score = 50 | PR |
| Fallback / kill-switch policy | Documented rollback path | Score = 60 | EN |

### D13. Regulatory Compliance (EU AI Act + GDPR + DORA) (weight 15)
| Evidence | Acceptance | Fallback | Tier |
|----------|------------|----------|------|
| AI Act risk classification (Annex III) | Self-assessed + justified | Hard red flag if high-risk & no conformity | PR |
| Technical documentation (Annex IV) | Complete for high-risk systems | Cap 65 | PR |
| Post-market monitoring plan (Art. 72) | Metrics + trigger thresholds | Score = 50 | PR |
| Incident reporting SOP (Art. 73) | 15-day timeline for serious incidents | Score = 60 | PR |
| DORA ICT third-party register entry | For EU financial clients | Hard red flag | EN |
| GDPR Art. 30 ROPA extract | For processing touching vendor | Score = 60 | PR |

---

## Cross-cutting verification (applied across all dimensions)

1. **Timestamp check** — evidence dated ≤ 12 months (ST) / ≤ 6 months (PR) / ≤ 3 months (EN)
2. **Authenticity check** — PDFs parsed for digital signature, EXIF for screenshots
3. **Counter-party match** — company name on evidence matches legal entity in report
4. **Redaction check** — required fields (e.g. signatory, date) not fully redacted

## Missing-evidence handling

- **Starter:** Score = 40 default, listed in "Data gaps" appendix
- **Pro:** Analyst requests once; if not provided in 48h → cap 65 + red flag
- **Enterprise:** Blocking issue; delivery paused until provided or documented in RACI

## Storage format

Evidence uploaded to `/evidence/{vendor_id}/{dimension_code}/` in immutable S3 bucket (object-lock 7 years for audit). SHA-256 hash recorded in `evidence_log` DB table.
