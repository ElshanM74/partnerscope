/**
 * DNS_001 — basic DNS hygiene check.
 *
 * Verifies:
 *   - domain resolves (A or AAAA)
 *   - NS records exist
 *   - MX records exist (email deliverability precondition — flagged warn if missing)
 *
 * Pure Node — uses `node:dns/promises`. No external deps, no API keys.
 */

import { Resolver } from 'node:dns/promises';

import {
  type TestInput,
  type TestResult,
  type TestRunner,
  resultError,
  resultFail,
  resultOk,
  resultWarn,
} from './types.js';

export interface DnsResolver {
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
  resolveNs(domain: string): Promise<string[]>;
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
}

/** Build a Node dns resolver with a hard timeout. */
function defaultResolver(timeoutMs: number): DnsResolver {
  const r = new Resolver({ timeout: timeoutMs, tries: 1 });
  return {
    resolve4: (d) => r.resolve4(d),
    resolve6: (d) => r.resolve6(d),
    resolveNs: (d) => r.resolveNs(d),
    resolveMx: (d) => r.resolveMx(d),
  };
}

/** Exposed for tests so callers can inject a mock resolver. */
export async function runDns(input: TestInput, resolver?: DnsResolver): Promise<TestResult> {
  const id = 'DNS_001';
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const timeoutMs = input.timeoutMs ?? 10_000;
  const r = resolver ?? defaultResolver(timeoutMs);

  const [a, aaaa, ns, mx] = await Promise.all([
    r.resolve4(input.domain).catch(() => [] as string[]),
    r.resolve6(input.domain).catch(() => [] as string[]),
    r.resolveNs(input.domain).catch(() => [] as string[]),
    r.resolveMx(input.domain).catch(() => [] as { exchange: string; priority: number }[]),
  ]);

  const dur = Date.now() - start;
  const detail = {
    a: a.length,
    aaaa: aaaa.length,
    nsCount: ns.length,
    mxCount: mx.length,
    ns,
    mx: mx.map((m) => m.exchange),
  };

  if (a.length === 0 && aaaa.length === 0) {
    return resultFail(
      id,
      `Domain ${input.domain} has no A or AAAA records — does not resolve.`,
      startedAt,
      dur,
      detail,
    );
  }
  if (ns.length === 0) {
    return resultError(
      id,
      `Domain ${input.domain} has no NS records returned (lookup inconclusive).`,
      startedAt,
      dur,
      detail,
    );
  }
  if (mx.length === 0) {
    return resultWarn(
      id,
      'No MX records — domain cannot receive email (not always required for a B2B API vendor).',
      startedAt,
      dur,
      detail,
    );
  }
  return resultOk(
    id,
    `DNS healthy: ${a.length + aaaa.length} A/AAAA, ${ns.length} NS, ${mx.length} MX records.`,
    startedAt,
    dur,
    detail,
  );
}

export const dnsRunner: TestRunner = {
  id: 'DNS_001',
  name: 'DNS hygiene',
  dimensionCode: 'D08',
  tiers: ['starter', 'pro', 'enterprise'],
  run: (input) => runDns(input),
};
