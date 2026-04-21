/**
 * DNS_001 tests — inject a fake resolver so we don't actually hit DNS.
 */

import { describe, expect, it } from 'vitest';

import { runDns } from './dns.js';
import type { DnsResolver } from './dns.js';

function fakeResolver(
  overrides: Partial<DnsResolver> = {},
  defaults: {
    a?: string[];
    aaaa?: string[];
    ns?: string[];
    mx?: { exchange: string; priority: number }[];
  } = {},
): DnsResolver {
  return {
    resolve4: async () => defaults.a ?? ['93.184.216.34'],
    resolve6: async () => defaults.aaaa ?? [],
    resolveNs: async () => defaults.ns ?? ['ns1.example.com', 'ns2.example.com'],
    resolveMx: async () => defaults.mx ?? [{ exchange: 'mx.example.com', priority: 10 }],
    ...overrides,
  };
}

describe('runDns', () => {
  it('passes when A + NS + MX all present', async () => {
    const r = await runDns({ domain: 'example.com' }, fakeResolver());
    expect(r.status).toBe('pass');
    expect(r.finding).toMatch(/DNS healthy/);
    expect(r.detail?.mxCount).toBe(1);
  });

  it('fails when domain has no A/AAAA records', async () => {
    const r = await runDns({ domain: 'nx.example' }, fakeResolver({}, { a: [], aaaa: [] }));
    expect(r.status).toBe('fail');
    expect(r.finding).toMatch(/no A or AAAA/);
  });

  it('warns when MX is missing', async () => {
    const r = await runDns({ domain: 'example.com' }, fakeResolver({}, { mx: [] }));
    expect(r.status).toBe('warn');
    expect(r.finding).toMatch(/No MX records/);
  });

  it('errors when NS resolution fails cleanly', async () => {
    const r = await runDns({ domain: 'example.com' }, fakeResolver({}, { ns: [] }));
    expect(r.status).toBe('error');
  });

  it('never throws even if resolver rejects', async () => {
    const resolver: DnsResolver = {
      resolve4: () => Promise.reject(new Error('boom')),
      resolve6: () => Promise.reject(new Error('boom')),
      resolveNs: () => Promise.reject(new Error('boom')),
      resolveMx: () => Promise.reject(new Error('boom')),
    };
    const r = await runDns({ domain: 'example.com' }, resolver);
    expect(r.status).toBe('fail');
  });
});
