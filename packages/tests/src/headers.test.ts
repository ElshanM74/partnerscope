/**
 * HDR_001 tests — inject a fake fetch returning canned headers.
 */

import { describe, expect, it } from 'vitest';

import { type HeaderFetch, runHeaders } from './headers.js';

function fetchReturning(h: Record<string, string>, status = 200): HeaderFetch {
  const headers = new Headers(h);
  return async () => ({ status, headers });
}

describe('runHeaders', () => {
  it('passes when 4+ security headers present', async () => {
    const h = fetchReturning({
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'content-security-policy': "default-src 'self'",
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    const r = await runHeaders({ domain: 'example.com' }, h);
    expect(r.status).toBe('pass');
    expect(r.finding).toMatch(/5\/5/);
  });

  it('warns when 2-3 headers present', async () => {
    const h = fetchReturning({
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
    });
    const r = await runHeaders({ domain: 'example.com' }, h);
    expect(r.status).toBe('warn');
  });

  it('fails when 0-1 headers present', async () => {
    const h = fetchReturning({ 'x-content-type-options': 'nosniff' });
    const r = await runHeaders({ domain: 'example.com' }, h);
    expect(r.status).toBe('fail');
  });

  it('accepts CSP frame-ancestors in lieu of X-Frame-Options', async () => {
    const h = fetchReturning({
      'strict-transport-security': 'max-age=31536000',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    const r = await runHeaders({ domain: 'example.com' }, h);
    expect(r.status).toBe('pass');
    const presence = r.detail?.presence as Record<string, boolean>;
    expect(presence.clickjack).toBe(true);
  });

  it('returns error when fetch throws', async () => {
    const h: HeaderFetch = () => Promise.reject(new Error('ENETUNREACH'));
    const r = await runHeaders({ domain: 'example.com' }, h);
    expect(r.status).toBe('error');
  });
});
