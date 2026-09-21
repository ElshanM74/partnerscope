/**
 * Tier entitlements (feature flags) — canonical programmatic mapping.
 *
 * Source: docs/partnerscope-spec/01_internal_logic/tier_entitlements.md
 */

import type { DimensionCode, Tier } from './types.js';

export interface TierEntitlements {
  tier: Tier;
  priceEur: number;
  paymentModel: 'free' | 'one_off' | 'quarterly_retainer';
  introDiscountEur?: number;
  maxQuestions: number;
  dimensions: readonly DimensionCode[] | 'all_plus_custom';
  automatedTests: readonly string[] | 'all_12';
  documentReviewLimit: number | null;
  redteamSuite: 'none' | 'lite_5_prompt_injection' | 'full';
  analystReview: boolean;
  /** 0 = instant, otherwise target hours. */
  slaHours: number;
  annex3Mapping: boolean;
  gdprDpaCheck: boolean;
  biasFairnessAudit: boolean;
  adversarialTesting: boolean;
  referenceCalls: number;
  siteVisit: 'none' | 'virtual' | 'on_site';
  continuousMonitoring: boolean;
  driftAlerts: number;
  quarterlyReassessment: boolean;
  dashboard: boolean;
  grcIntegrations: readonly string[];
  sso: 'none' | 'saml';
  dedicatedAnalyst: boolean;
  /** Priority SLA only applies to Enterprise. */
  slaPriorityHours?: number;
  supportChannel: 'none' | 'email' | 'dedicated_slack';
  minVendors?: number;
  customDimensionsAllowed: boolean;
  annualDiscountPct?: number;
  reportPdf: 'none' | 'instant' | 'analyst_reviewed_pdf' | 'on_demand';
}

const ALL_DIMS: DimensionCode[] = [
  'D01',
  'D02',
  'D03',
  'D04',
  'D05',
  'D06',
  'D07',
  'D08',
  'D09',
  'D10',
  'D11',
  'D12',
  'D13',
];

export const TIER_ENTITLEMENTS: Readonly<Record<Tier, TierEntitlements>> = {
  free_snapshot: {
    tier: 'free_snapshot',
    priceEur: 0,
    paymentModel: 'free',
    maxQuestions: 6,
    dimensions: ['D11', 'D12', 'D13'],
    automatedTests: [],
    documentReviewLimit: null,
    redteamSuite: 'none',
    analystReview: false,
    slaHours: 0,
    annex3Mapping: false,
    gdprDpaCheck: false,
    biasFairnessAudit: false,
    adversarialTesting: false,
    referenceCalls: 0,
    siteVisit: 'none',
    continuousMonitoring: false,
    driftAlerts: 0,
    quarterlyReassessment: false,
    dashboard: true,
    grcIntegrations: [],
    sso: 'none',
    dedicatedAnalyst: false,
    supportChannel: 'none',
    customDimensionsAllowed: false,
    reportPdf: 'none',
  },
  starter: {
    tier: 'starter',
    priceEur: 99,
    paymentModel: 'one_off',
    maxQuestions: 33,
    dimensions: ALL_DIMS,
    automatedTests: ['DNS_001', 'TLS_001', 'HDR_001', 'CT_001'],
    documentReviewLimit: 0,
    redteamSuite: 'none',
    analystReview: false,
    slaHours: 0, // instant
    annex3Mapping: false,
    gdprDpaCheck: false,
    biasFairnessAudit: false,
    adversarialTesting: false,
    referenceCalls: 0,
    siteVisit: 'none',
    continuousMonitoring: false,
    driftAlerts: 0,
    quarterlyReassessment: false,
    dashboard: true,
    grcIntegrations: [],
    sso: 'none',
    dedicatedAnalyst: false,
    supportChannel: 'email',
    customDimensionsAllowed: false,
    reportPdf: 'instant',
  },
  pro: {
    tier: 'pro',
    priceEur: 299,
    paymentModel: 'one_off',
    maxQuestions: 55,
    dimensions: ALL_DIMS,
    automatedTests: ['DNS_001', 'TLS_001', 'HDR_001', 'CT_001'],
    documentReviewLimit: 10,
    redteamSuite: 'none',
    analystReview: true,
    slaHours: 120, // Planning target; contractual delivery uses business days.
    annex3Mapping: true,
    gdprDpaCheck: true,
    biasFairnessAudit: false,
    adversarialTesting: false,
    referenceCalls: 0,
    siteVisit: 'none',
    continuousMonitoring: false,
    driftAlerts: 0,
    quarterlyReassessment: false,
    dashboard: true,
    grcIntegrations: [],
    sso: 'none',
    dedicatedAnalyst: false,
    supportChannel: 'email',
    customDimensionsAllowed: false,
    reportPdf: 'analyst_reviewed_pdf',
  },
  enterprise: {
    tier: 'enterprise',
    priceEur: 4900,
    paymentModel: 'quarterly_retainer',
    maxQuestions: 55,
    dimensions: 'all_plus_custom',
    automatedTests: ['DNS_001', 'TLS_001', 'HDR_001', 'CT_001'],
    documentReviewLimit: null,
    redteamSuite: 'none',
    analystReview: true,
    slaHours: 0, // priority tracked separately
    slaPriorityHours: 24,
    annex3Mapping: true,
    gdprDpaCheck: true,
    biasFairnessAudit: true,
    adversarialTesting: true,
    referenceCalls: 3,
    siteVisit: 'virtual',
    continuousMonitoring: false,
    driftAlerts: 0,
    quarterlyReassessment: false, // Scheduled manually under the Enterprise contract.
    dashboard: true,
    grcIntegrations: [],
    sso: 'none',
    dedicatedAnalyst: true,
    supportChannel: 'email',
    minVendors: 15,
    customDimensionsAllowed: true,
    reportPdf: 'on_demand',
  },
} as const;

export function getEntitlements(tier: Tier): TierEntitlements {
  const e = TIER_ENTITLEMENTS[tier];
  if (!e) throw new Error(`Unknown tier: ${tier}`);
  return e;
}
