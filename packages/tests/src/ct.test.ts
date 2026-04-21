/**
 * CT_001 tests — inject a fake crt.sh fetcher.
 */

import { describe, expect, it } from 'vitest';

import { type CtFetch, type CtLogEntry, runCt } from './ct.js';

function fetchReturning(
  body: CtLogEntry[] | null,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
): CtFetch {
  return async () => ({
    ok,
    status,
    json: async () => body ?? [],
  });
}

describe('runCt', () => {
  it('passes on a modest set of CT entries', async () => {
    const entries: CtLogEntry[] = [
      { issuer_name: "Let's Encrypt", name_value: 'example.com\nwww.example.com' },
      { issuer_name: "Let's Encrypt", name_value: 'api.example.com' },
    ];
    const r = await runCt({ domain: 'example.com' }, fetchReturning(entries));
    expect(r.status).toBe('pass');
    expect(r.detail?.uniqueNames).toBe(3);
  });

  it('warns when subdomain count exceeds threshold', async () => {
    const names = Array.from({ length: 60 }, (_, i) => `sub${i}.example.com`).join('\n');
    const entries: CtLogEntry[] = [{ issuer_name: "Let's Encrypt", name_value: names }];
    const r = await runCt({ domain: 'example.com' }, fetchReturning(entries));
    expect(r.status).toBe('warn');
    expect(r.finding).toMatch(/distinct names/);
  });

  it('warns when no CT entries exist at all', async () => {
    const r = await runCt({ domain: 'brandnew.example' }, fetchReturning([]));
    expect(r.status).toBe('warn');
    expect(r.detail?.entryCount).toBe(0);
  });

  it('errors when crt.sh returns non-OK', async () => {
    const r = await runCt(
      { domain: 'example.com' },
      fetchReturning(null, { ok: false, status: 503 }),
    );
    expect(r.status).toBe('error');
  });

  it('errors when fetch throws', async () => {
    const f: CtFetch = () => Promise.reject(new Error('timeout'));
    const r = await runCt({ domain: 'example.com' }, f);
    expect(r.status).toBe('error');
  });
});
