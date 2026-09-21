import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const boundaries = vi.hoisted(() => ({
  suite: vi.fn(),
  pdf: vi.fn(),
  research: vi.fn(),
  put: vi.fn(),
}));
vi.mock('@partnerscope/tests', () => ({ runSuite: boundaries.suite }));
vi.mock('./pdf/index.js', () => ({
  renderEvidenceReportPdf: boundaries.pdf,
  buildReportId: () => 'PS-TEST',
}));
vi.mock('./research/index.js', async (original) => ({
  ...(await original<typeof import('./research/index.js')>()),
  research: boundaries.research,
}));
vi.mock('./storage.js', () => ({
  getStorage: () => ({ put: boundaries.put }),
  StorageKeys: { runReportPdf: (id: string) => `runs/${id}/report.pdf` },
}));
import { env } from '../config/env.js';
import { pool } from '../db/client.js';
import { prepareAssessment } from './fulfillment.js';
const id = '214f8785-4eef-4f23-9cb2-d56cf0a00cf4';
const result = (rows: unknown[]) => ({
  rows,
  rowCount: rows.length,
  command: 'UPDATE',
  oid: 0,
  fields: [],
});
const checks = ['DNS', 'TLS', 'HEADERS', 'CT'].map((id) => ({
  id,
  status: 'error',
  finding: 'Service unavailable',
  startedAt: '2026-09-21T00:00:00Z',
  durationMs: 1,
}));
let key: string | undefined;
beforeEach(() => {
  key = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = 'test-key';
  boundaries.suite.mockResolvedValue(checks);
  boundaries.pdf.mockResolvedValue(Buffer.from('pdf-test'));
  boundaries.put.mockResolvedValue({});
});
afterEach(() => {
  env.OPENAI_API_KEY = key;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function setup(tier: string, reportJson = {}) {
  return vi
    .spyOn(pool, 'query')
    .mockResolvedValueOnce(
      result([
        {
          id,
          tier,
          vendor_id: id,
          organization_id: id,
          report_json: reportJson,
          claim_updated_at: '2026-09-21 00:00:00+00',
        },
      ]),
    )
    .mockResolvedValueOnce(result([{ legalName: 'Example', domain: 'example.com', country: 'AZ' }]))
    .mockResolvedValue(result([{ id }]));
}
describe('assessment fulfillment orchestration', () => {
  it('does not run services for already claimed work', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue(result([]));
    expect(await prepareAssessment(id)).toEqual({ claimed: false });
    expect(boundaries.suite).not.toHaveBeenCalled();
  });
  it('delivers Starter observations without scoring or research, retaining service errors', async () => {
    const db = setup('starter');
    expect(await prepareAssessment(id)).toEqual({ claimed: true, status: 'delivered' });
    expect(boundaries.research).not.toHaveBeenCalled();
    expect(boundaries.pdf.mock.calls[0][0].tests).toEqual(checks);
    expect(boundaries.suite.mock.invocationCallOrder[0]).toBeLessThan(
      boundaries.pdf.mock.invocationCallOrder[0],
    );
    const args = db.mock.calls.at(-1)?.[1] as unknown[];
    expect(args[1]).toBe('delivered');
    const report = JSON.parse(String(args[2]));
    expect(report).not.toHaveProperty('scoring');
    expect(report.tests.every((t: { status: string }) => t.status === 'error')).toBe(true);
  });
  it('keeps Pro draft for analyst review with explicitly defaulted context', async () => {
    setup('pro');
    boundaries.research.mockResolvedValue({
      report: 'Public-source fixture',
      sources: [{ url: 'https://example.com', title: 'Fixture' }],
      citations: [],
    });
    expect(await prepareAssessment(id)).toEqual({ claimed: true, status: 'analyst_review' });
    expect(boundaries.research.mock.calls[0][0].task).toContain('No specific procurement brief');
    const pdf = boundaries.pdf.mock.calls[0][0];
    expect(pdf.review).toBeUndefined();
    expect(pdf.scope).toContain('Draft');
  });
  it('retains Enterprise contract scope in stored report and PDF without claiming portfolio completion', async () => {
    const scopeApproval = {
      staffUserId: id,
      contractReference: 'QA-2026',
      scope: 'Review three vendors for a specifically agreed portfolio engagement.',
      approvedAt: '2026-09-21T00:00:00.000Z',
    };
    const db = setup('enterprise', { enterpriseScopeApproved: true, scopeApproval });
    boundaries.research.mockResolvedValue({ report: 'Fixture', sources: [], citations: [] });
    expect(await prepareAssessment(id)).toEqual({ claimed: true, status: 'analyst_review' });
    const args = db.mock.calls.at(-1)?.[1] as unknown[];
    const saved = JSON.parse(String(args[2]));
    expect(saved.scopeApproval).toEqual(scopeApproval);
    expect(saved.enterpriseScopeApproved).toBe(true);
    expect(boundaries.pdf.mock.calls[0][0].scopeApproval).toEqual(scopeApproval);
    expect(saved.limitations.join(' ')).toContain('does not mark the wider Enterprise engagement');
  });
  it('does not publish a stale attempt or overwrite its successor PDF', async () => {
    const db = setup('starter');
    db.mockResolvedValue(result([]));
    expect(await prepareAssessment(id)).toEqual({ claimed: true, status: 'failed' });
    const claimArgs = db.mock.calls[0][1] as unknown[];
    const finalArgs = db.mock.calls.at(-1)?.[1] as unknown[];
    expect(finalArgs[4]).toBe(claimArgs[1]);
    expect(String(db.mock.calls.at(-1)?.[0])).toContain("report_json->>'attemptToken'=$5");
    expect(String(db.mock.calls.at(-1)?.[0])).toContain('updated_at=$6::timestamptz');
    expect(boundaries.put.mock.calls[0][0]).toBe(`runs/${id}/attempt-${claimArgs[1]}.pdf`);
    expect(db.mock.calls).toHaveLength(3);
  });
  it('prepares free snapshots without the legacy scoring or research paths', async () => {
    setup('free_snapshot');
    expect(await prepareAssessment(id)).toEqual({ claimed: true, status: 'delivered' });
    expect(boundaries.research).not.toHaveBeenCalled();
  });
  it('marks failed when research is unavailable instead of fabricating a report', async () => {
    const db = setup('pro');
    env.OPENAI_API_KEY = undefined;
    expect(await prepareAssessment(id)).toEqual({ claimed: true, status: 'failed' });
    expect(boundaries.pdf).not.toHaveBeenCalled();
    expect(String(db.mock.calls.at(-1)?.[0])).toContain("status='failed'");
  });
  it('marks PDF failures failed and never delivers', async () => {
    const db = setup('starter');
    boundaries.pdf.mockRejectedValueOnce(new Error('browser unavailable secret=do-not-persist'));
    expect(await prepareAssessment(id)).toEqual({ claimed: true, status: 'failed' });
    expect(boundaries.put).not.toHaveBeenCalled();
    expect(String(db.mock.calls.at(-1)?.[0])).toContain("status='failed'");
    const args = db.mock.calls.at(-1)?.[1] as unknown[];
    expect(JSON.parse(String(args[1])).fulfillmentError).toBe('pdf_renderer_failed');
    expect(String(args[1])).not.toContain('do-not-persist');
  });
});
