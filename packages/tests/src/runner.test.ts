/**
 * Orchestrator tests — make sure tier gating + runner isolation works.
 */

import { describe, expect, it } from 'vitest';

import { ALL_RUNNERS, runnersForTier } from './runner.js';

describe('runnersForTier', () => {
  it('returns every runner for Starter (current catalogue)', () => {
    const r = runnersForTier('starter');
    expect(r.map((x) => x.id).sort()).toEqual(['CT_001', 'DNS_001', 'HDR_001', 'TLS_001']);
  });

  it('includes all runners for Pro and Enterprise', () => {
    expect(runnersForTier('pro')).toHaveLength(ALL_RUNNERS.length);
    expect(runnersForTier('enterprise')).toHaveLength(ALL_RUNNERS.length);
  });

  it('has stable IDs — never renumber', () => {
    const ids = ALL_RUNNERS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Z]{2,3}_[0-9]{3}$/);
    }
  });
});
