/**
 * Test orchestrator — runs a tier-gated suite against a single vendor.
 *
 * Each runner gets its own (configurable) timeout; the orchestrator itself
 * runs them concurrently and returns a stable array. An individual runner
 * should never throw — but if it does, we catch here and synthesise an
 * `error` result so one bad runner doesn't derail the Starter delivery.
 */

import { ctRunner } from './ct.js';
import { dnsRunner } from './dns.js';
import { headersRunner } from './headers.js';
import { tlsRunner } from './tls.js';
import { type TestInput, type TestResult, type TestRunner, resultError } from './types.js';

export type Tier = 'starter' | 'pro' | 'enterprise';

/** All runners currently implemented. Keep ordered by stable ID. */
export const ALL_RUNNERS: readonly TestRunner[] = [
  ctRunner,
  dnsRunner,
  headersRunner,
  tlsRunner,
] as const;

/** Return the runners gated for a given tier. */
export function runnersForTier(tier: Tier): readonly TestRunner[] {
  return ALL_RUNNERS.filter((r) => r.tiers.includes(tier));
}

export interface SuiteInput extends TestInput {
  tier: Tier;
  /** Only run these test IDs (intersection with the tier gates). */
  onlyIds?: string[];
}

export async function runSuite(input: SuiteInput): Promise<TestResult[]> {
  const gated = runnersForTier(input.tier);
  const selected = input.onlyIds ? gated.filter((r) => input.onlyIds?.includes(r.id)) : gated;

  const probe: TestInput = { domain: input.domain, timeoutMs: input.timeoutMs };
  const results = await Promise.all(
    selected.map(async (r) => {
      const started = new Date().toISOString();
      const start = Date.now();
      try {
        return await r.run(probe);
      } catch (err) {
        return resultError(
          r.id,
          `Runner ${r.id} threw: ${(err as Error).message}`.slice(0, 140),
          started,
          Date.now() - start,
          { error: (err as Error).message },
        );
      }
    }),
  );

  // Stable order: by runner id.
  return results.sort((a, b) => a.id.localeCompare(b.id));
}
