/**
 * PDF renderer tests — HTML path only.
 *
 * We don't exercise Puppeteer here (it's a multi-hundred-MB Chromium
 * dependency that shouldn't run in every CI shard). Instead we assert
 * that the Handlebars template renders all the structural elements the
 * client spec requires, given a realistic ScoringResult.
 */

import { describe, expect, it } from 'vitest';

import { DIMENSIONS, calculateScoring, questionsForTier } from '@partnerscope/core';

// Ensure env validation passes.
process.env.DATABASE_URL ??= 'postgres://localhost:5432/partnerscope_test';

import { buildReportId, renderStarterReportHtml } from './index.js';

function synthStarterResponses() {
  return questionsForTier('starter').map((q) => ({
    questionId: q.id,
    rawAnswer: { type: 'likert' as const, value: 4 as const },
    numericScore: 75,
  }));
}

describe('renderStarterReportHtml', () => {
  it('renders all required sections for a realistic Starter scoring', async () => {
    const scoring = calculateScoring({ tier: 'starter', responses: synthStarterResponses() });

    const html = await renderStarterReportHtml({
      reportId: 'PS-2026-STA-ABCDEF',
      issueDate: '2026-04-20',
      validUntil: '2026-07-19',
      tierName: 'Starter',
      vendor: { legalName: 'Acme Robotics GmbH', domain: 'acme.example', country: 'DE' },
      buyer: { name: 'Test Buyer', company: 'BuyerCo', email: 'buyer@test.example' },
      scoring,
      upgradeUrl: 'https://partnerscope.eu/upgrade?from=PS-2026-STA-ABCDEF',
    });

    // Header + vendor
    expect(html).toContain('PARTNERSCOPE SNAPSHOT');
    expect(html).toContain('Acme Robotics GmbH');
    expect(html).toContain('acme.example');

    // Core sections
    expect(html).toContain('Executive summary');
    expect(html).toContain('13-dimension scorecard');
    expect(html).toContain('Automated test results');
    expect(html).toContain('Red flags');
    expect(html).toContain('Data gaps');
    expect(html).toContain('Upgrade path');
    expect(html).toContain('Methodology');

    // Composite score present
    expect(html).toContain(`${scoring.compositeScore}`);

    // All 13 dimensions present in the scorecard
    for (const d of DIMENSIONS) {
      expect(html).toContain(d.code);
    }

    // Verdict label present
    expect(/PROCEED|PROCEED WITH CONDITIONS|HOLD|DECLINE/.test(html)).toBe(true);
  });

  it('buildReportId is deterministic for Starter', () => {
    const id = buildReportId('starter', '12345678-aaaa-bbbb-cccc-000000000000', 2026);
    expect(id).toBe('PS-2026-STA-123456');
  });
});
