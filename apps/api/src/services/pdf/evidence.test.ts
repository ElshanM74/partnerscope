import { describe, expect, it } from 'vitest';
import { type EvidenceReportInput, renderEvidenceReportHtml } from './index.js';
const input: EvidenceReportInput = {
  reportId: 'PS-TEST',
  preparedAt: '2026-09-21T00:00:00Z',
  scope: 'Technical snapshot',
  context: {
    country: 'AZ',
    task: 'Supplier review',
    criteria: 'Team and deadlines',
    defaulted: true,
  },
  vendor: { legalName: '<script>unsafe()</script>', domain: 'example.com' },
  tests: [
    {
      id: 'TLS',
      status: 'error',
      finding: 'Could not connect',
      startedAt: '2026-09-21T00:00:00Z',
      durationMs: 100,
    },
  ],
  limitations: ['Domain only'],
};
describe('evidence report', () => {
  it('escapes input and explains technical errors without an invented score', () => {
    const html = renderEvidenceReportHtml(input);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('not an adverse finding');
    expect(html).not.toContain('PROCEED');
    expect(html).not.toContain('/100');
    expect(html).toContain('2026-09-21T00:00:00Z');
    expect(html).toContain('Country:</strong> AZ');
    expect(html).toContain('Team and deadlines');
    expect(html).toContain('Generic supplier-check context');
  });
  it('filters unsafe links and includes supplied review only', () => {
    const html = renderEvidenceReportHtml({
      ...input,
      research: {
        report: 'Sourced finding',
        sources: [
          { title: 'Bad', url: 'javascript:alert(1)' },
          { title: 'Public source', url: 'https://example.com' },
        ],
      },
      review: {
        analystName: 'Named Reviewer',
        reviewedAt: '2026-09-21',
        recommendation: 'Request reference',
        conditions: 'Verify team',
      },
    });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.com');
    expect(html).toContain('Named Reviewer');
    expect(html).toContain('Verify team');
  });
});
