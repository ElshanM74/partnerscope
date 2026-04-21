/**
 * HDR_001 — HTTP security headers check.
 *
 * Fetches `https://{domain}/` and inspects the response headers.
 * Scores against a small required set:
 *   - Strict-Transport-Security (HSTS)
 *   - Content-Security-Policy (CSP)
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options OR CSP frame-ancestors
 *   - Referrer-Policy
 *
 * Verdict:
 *   - ≥ 4 present → pass
 *   - 2-3 present → warn
 *   - ≤ 1 present → fail
 */

import {
  type TestInput,
  type TestResult,
  type TestRunner,
  resultError,
  resultFail,
  resultOk,
  resultWarn,
} from './types.js';

export type HeaderFetch = (
  url: string,
  init: { method: 'HEAD' | 'GET'; redirect: 'follow'; signal: AbortSignal },
) => Promise<{ status: number; headers: Headers }>;

const defaultHeaderFetch: HeaderFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, headers: res.headers };
};

interface HeaderPresence {
  hsts: boolean;
  csp: boolean;
  xcto: boolean;
  clickjack: boolean;
  referrer: boolean;
}

function analyseHeaders(headers: Headers): HeaderPresence {
  const csp = headers.get('content-security-policy') ?? '';
  const xfo = headers.get('x-frame-options') ?? '';
  return {
    hsts: (headers.get('strict-transport-security') ?? '').length > 0,
    csp: csp.length > 0,
    xcto: (headers.get('x-content-type-options') ?? '').toLowerCase().includes('nosniff'),
    clickjack: xfo.length > 0 || /frame-ancestors/i.test(csp),
    referrer: (headers.get('referrer-policy') ?? '').length > 0,
  };
}

export async function runHeaders(
  input: TestInput,
  fetchImpl: HeaderFetch = defaultHeaderFetch,
): Promise<TestResult> {
  const id = 'HDR_001';
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const timeoutMs = input.timeoutMs ?? 10_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Try HEAD first (cheaper). Fall back to GET if the vendor rejects HEAD.
    let res = await fetchImpl(`https://${input.domain}/`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    }).catch(() => null);
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetchImpl(`https://${input.domain}/`, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
    }

    const presence = analyseHeaders(res.headers);
    const count = Object.values(presence).filter(Boolean).length;
    const dur = Date.now() - start;

    const missing = Object.entries(presence)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    const detail: Record<string, unknown> = {
      status: res.status,
      presence,
      missing,
    };

    if (count >= 4) {
      return resultOk(
        id,
        `${count}/5 security headers present (${missing.length > 0 ? `missing: ${missing.join(', ')}` : 'all set'}).`,
        startedAt,
        dur,
        detail,
      );
    }
    if (count >= 2) {
      return resultWarn(
        id,
        `Only ${count}/5 security headers present — missing: ${missing.join(', ')}.`,
        startedAt,
        dur,
        detail,
      );
    }
    return resultFail(
      id,
      `Only ${count}/5 security headers present — missing: ${missing.join(', ')}.`,
      startedAt,
      dur,
      detail,
    );
  } catch (err) {
    const dur = Date.now() - start;
    const msg = (err as Error).message;
    return resultError(
      id,
      `Could not fetch https://${input.domain}/ — ${msg}`.slice(0, 140),
      startedAt,
      dur,
      { error: msg },
    );
  } finally {
    clearTimeout(timer);
  }
}

export const headersRunner: TestRunner = {
  id: 'HDR_001',
  name: 'HTTP security headers',
  dimensionCode: 'D08',
  tiers: ['starter', 'pro', 'enterprise'],
  run: (input) => runHeaders(input),
};
