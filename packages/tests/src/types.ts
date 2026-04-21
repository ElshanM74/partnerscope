/**
 * Shared types for the automated-test runners.
 *
 * Every runner takes a `TestInput` (minimum: vendor domain) and returns a
 * `TestResult`. Results are small, serialisable, and safe to persist to the
 * runs.reportJson payload / Starter PDF `tests` array.
 *
 * Status semantics:
 *  - pass  — control present / healthy.
 *  - warn  — partial issue; not a deal-breaker.
 *  - fail  — material control gap; surfaces in the "Red flags" section.
 *  - error — the test could not execute (timeout, DNS failure); no verdict.
 */

export type TestStatus = 'pass' | 'warn' | 'fail' | 'error';

export interface TestInput {
  /** Vendor domain, e.g. "acme.example". Lower-cased, no protocol. */
  domain: string;
  /** Per-test timeout. Defaults to 10_000ms. */
  timeoutMs?: number;
}

export interface TestResult {
  /** Stable test ID, matches the catalogue (e.g. "DNS_001"). */
  id: string;
  /** Verdict. */
  status: TestStatus;
  /** One-line, buyer-facing finding. Keep < 140 chars. */
  finding: string;
  /** Optional structured detail for the long-form report view. */
  detail?: Record<string, unknown>;
  /** Milliseconds spent running the test. */
  durationMs: number;
  /** ISO timestamp at start of run. */
  startedAt: string;
}

export interface TestRunner {
  /** Stable test ID. */
  readonly id: string;
  /** Short human-readable name. */
  readonly name: string;
  /** Which PartnerScope dimension this test primarily informs. */
  readonly dimensionCode: string;
  /** Tier gates (which tiers include this test by default). */
  readonly tiers: ReadonlyArray<'starter' | 'pro' | 'enterprise'>;
  /** Execute. Must never throw — return `status: 'error'` instead. */
  run(input: TestInput): Promise<TestResult>;
}

// ────────────────────────────────────────────────────────────────
// Result helpers — keep runners concise.
// ────────────────────────────────────────────────────────────────

export function resultOk(
  id: string,
  finding: string,
  startedAt: string,
  durationMs: number,
  detail?: Record<string, unknown>,
): TestResult {
  return { id, status: 'pass', finding, startedAt, durationMs, detail };
}

export function resultWarn(
  id: string,
  finding: string,
  startedAt: string,
  durationMs: number,
  detail?: Record<string, unknown>,
): TestResult {
  return { id, status: 'warn', finding, startedAt, durationMs, detail };
}

export function resultFail(
  id: string,
  finding: string,
  startedAt: string,
  durationMs: number,
  detail?: Record<string, unknown>,
): TestResult {
  return { id, status: 'fail', finding, startedAt, durationMs, detail };
}

export function resultError(
  id: string,
  finding: string,
  startedAt: string,
  durationMs: number,
  detail?: Record<string, unknown>,
): TestResult {
  return { id, status: 'error', finding, startedAt, durationMs, detail };
}
