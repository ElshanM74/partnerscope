/**
 * TLS_001 tests — inject a fake probe to avoid real network.
 */

import { describe, expect, it } from 'vitest';

import { type TlsProbe, runTls } from './tls.js';

function ymd(d: Date): string {
  // Node's cert validTo is "MMM DD HH:MM:SS YYYY GMT" — but new Date() parses
  // ISO fine and the runner only cares about Date parseability.
  return d.toISOString();
}

function probeWith(info: {
  protocol?: string | null;
  daysOffset: number;
  issuerCN?: string;
  subjectCN?: string;
}): TlsProbe {
  const validTo = new Date(Date.now() + info.daysOffset * 24 * 60 * 60 * 1000);
  return async () => ({
    protocol: info.protocol ?? 'TLSv1.3',
    validTo: ymd(validTo),
    subjectCN: info.subjectCN ?? 'example.com',
    issuerCN: info.issuerCN ?? "Let's Encrypt R3",
    alpnProtocol: 'h2',
  });
}

describe('runTls', () => {
  it('passes on healthy TLS 1.3 + fresh cert', async () => {
    const r = await runTls({ domain: 'example.com' }, probeWith({ daysOffset: 60 }));
    expect(r.status).toBe('pass');
    expect(r.finding).toMatch(/TLS healthy/);
  });

  it('warns when cert expires in < 14 days', async () => {
    const r = await runTls({ domain: 'example.com' }, probeWith({ daysOffset: 5 }));
    expect(r.status).toBe('warn');
    expect(r.finding).toMatch(/expires in 5 days/);
  });

  it('fails when cert is expired', async () => {
    const r = await runTls({ domain: 'example.com' }, probeWith({ daysOffset: -1 }));
    expect(r.status).toBe('fail');
    expect(r.finding).toMatch(/expired/);
  });

  it('fails on deprecated TLS protocol', async () => {
    const r = await runTls(
      { domain: 'example.com' },
      probeWith({ daysOffset: 60, protocol: 'TLSv1.1' }),
    );
    expect(r.status).toBe('fail');
    expect(r.finding).toMatch(/deprecated/);
  });

  it('fails when probe throws (handshake refused)', async () => {
    const probe: TlsProbe = () => Promise.reject(new Error('ECONNREFUSED'));
    const r = await runTls({ domain: 'example.com' }, probe);
    expect(r.status).toBe('fail');
    expect(r.finding).toMatch(/ECONNREFUSED/);
  });
});
