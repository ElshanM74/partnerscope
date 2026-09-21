import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ResearchInput, parseResearchResponse, publicUrl } from './index.js';
import { ResearchStore } from './store.js';

const input = {
  mode: 'check' as const,
  company: 'Example supplier',
  country: 'Azerbaijan',
  task: 'Check fibre installation experience',
  criteria: 'Team and deadlines',
};
function response(url = 'https://example.com/project') {
  return {
    status: 'completed',
    output: [
      { type: 'web_search_call', status: 'completed' },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Evidence [1]',
            annotations: [
              { type: 'url_citation', url, title: 'Source', start_index: 9, end_index: 12 },
            ],
          },
        ],
      },
    ],
  };
}
describe('Research result integrity', () => {
  it('requires a company in check mode, but allows discovery without one', () => {
    expect(ResearchInput.safeParse({ ...input, company: '' }).success).toBe(false);
    expect(ResearchInput.safeParse({ ...input, mode: 'search', company: '' }).success).toBe(true);
  });
  it('preserves citations and refuses reports without live search', () => {
    expect(parseResearchResponse(response()).sources).toHaveLength(1);
    const raw = response();
    raw.output.shift();
    expect(() => parseResearchResponse(raw)).toThrow('research_search_missing');
  });
  it('does not convert plain-text invented links into source evidence', () => {
    const raw = response();
    const content = raw.output[1]?.content?.[0];
    if (!content) throw new Error('Fixture missing');
    content.annotations = [];
    content.text = 'Claim https://made-up.example.com';
    expect(() => parseResearchResponse(raw)).toThrow('research_sources_missing');
  });
  it('rejects incomplete responses and unsafe or invalid citations', () => {
    expect(() => parseResearchResponse({ ...response(), status: 'incomplete' })).toThrow();
    expect(() => parseResearchResponse(response('javascript:alert(1)'))).toThrow();
    const raw = response();
    const citation = raw.output[1]?.content?.[0]?.annotations[0];
    if (!citation) throw new Error('Fixture missing');
    citation.end_index = 999;
    expect(() => parseResearchResponse(raw)).toThrow();
  });
  it('does not publish private-network or credentialed source links', () => {
    for (const url of [
      'http://localhost/a',
      'http://127.0.0.1/a',
      'https://user:pass@example.com',
      'file:///etc/passwd',
      'http://[::1]/',
    ])
      expect(publicUrl(url)).toBeNull();
  });
  it('isolates saved reports by organization and rejects path traversal', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ps-research-'));
    try {
      const store = new ResearchStore(dir);
      const org = randomUUID();
      const other = randomUUID();
      const report = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        request: input,
        ...parseResearchResponse(response()),
      };
      await store.save(org, report);
      expect(await store.get(org, report.id)).toEqual(report);
      expect(await store.get(other, report.id)).toBeNull();
      expect(await store.list(other)).toEqual([]);
      expect(await store.list(org)).toHaveLength(1);
      await expect(store.get(org, '../../secret')).rejects.toThrow();
      await expect(store.get('../other-org', report.id)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
