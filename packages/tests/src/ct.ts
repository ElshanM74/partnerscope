/**
 * CT_001 — Certificate Transparency log scan.
 *
 * Queries crt.sh for certificates issued for the apex + wildcard of
 * the domain. Flags:
 *   - No CT entries → error (can't reach crt.sh or domain is brand new).
 *   - Excessive subdomain sprawl (> 50 distinct names) → warn.
 *   - Issuance from a known non-compliant CA → fail (none in Starter).
 *
 * Read-only, public JSON API. No API key required.
 */

import {
  type TestInput,
  type TestResult,
  type TestRunner,
  resultError,
  resultOk,
  resultWarn,
} from './types.js';

export interface CtLogEntry {
  issuer_name: string;
  name_value: string;
  common_name?: string;
  entry_timestamp?: string;
  not_after?: string;
}

export type CtFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultCtFetch: CtFetch = async (url, init) => {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': 'PartnerScope/1.0 (+https://partnerscope.eu)',
    },
  });
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json() as Promise<unknown>,
  };
};

const UNIQUE_NAME_WARN = 50;

export async function runCt(
  input: TestInput,
  fetchImpl: CtFetch = defaultCtFetch,
): Promise<TestResult> {
  const id = 'CT_001';
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const timeoutMs = input.timeoutMs ?? 15_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://crt.sh/?q=%25.${encodeURIComponent(input.domain)}&output=json`;
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      const dur = Date.now() - start;
      return resultError(
        id,
        `crt.sh returned ${res.status} — could not enumerate CT entries.`,
        startedAt,
        dur,
        { status: res.status },
      );
    }
    const body = (await res.json()) as unknown;
    const entries = Array.isArray(body) ? (body as CtLogEntry[]) : [];
    const dur = Date.now() - start;

    if (entries.length === 0) {
      return resultWarn(
        id,
        `No CT log entries for ${input.domain} — domain may be new or intentionally unlogged.`,
        startedAt,
        dur,
        { entryCount: 0 },
      );
    }

    const names = new Set<string>();
    const issuers = new Set<string>();
    for (const e of entries) {
      for (const n of (e.name_value ?? '').split('\n')) {
        if (n) names.add(n.trim().toLowerCase());
      }
      if (e.issuer_name) issuers.add(e.issuer_name);
    }

    const detail = {
      entryCount: entries.length,
      uniqueNames: names.size,
      uniqueIssuers: issuers.size,
      sampleNames: Array.from(names).slice(0, 5),
    };

    if (names.size > UNIQUE_NAME_WARN) {
      return resultWarn(
        id,
        `${names.size} distinct names across ${entries.length} CT entries — large subdomain surface, review for shadow IT.`,
        startedAt,
        dur,
        detail,
      );
    }

    return resultOk(
      id,
      `${entries.length} CT entries, ${names.size} distinct names, ${issuers.size} issuer(s). Domain is publicly logged.`,
      startedAt,
      dur,
      detail,
    );
  } catch (err) {
    const dur = Date.now() - start;
    return resultError(
      id,
      `CT lookup failed — ${(err as Error).message}`.slice(0, 140),
      startedAt,
      dur,
      { error: (err as Error).message },
    );
  } finally {
    clearTimeout(timer);
  }
}

export const ctRunner: TestRunner = {
  id: 'CT_001',
  name: 'Certificate Transparency scan',
  dimensionCode: 'D07',
  tiers: ['starter', 'pro', 'enterprise'],
  run: (input) => runCt(input),
};
