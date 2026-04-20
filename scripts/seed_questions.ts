/**
 * scripts/seed_questions.ts
 *
 * Upserts the 55-question bank from `@partnerscope/core` into the
 * `questions` table in PostgreSQL. Idempotent — safe to re-run after
 * every spec revision.
 *
 * Usage:
 *   pnpm tsx scripts/seed_questions.ts
 *   DATABASE_URL=postgres://... pnpm tsx scripts/seed_questions.ts
 *
 * Exit codes:
 *   0 — success (N rows inserted/updated)
 *   1 — DB connection or SQL error
 *   2 — invariant violation (e.g. dimension/question count mismatch)
 */

import { Client } from 'pg';

import {
  DIMENSIONS,
  type DimensionCode,
  type PillarId,
  QUESTIONS,
  type Question,
  type TierGate,
} from '@partnerscope/core';

// ────────────────────────────────────────────────────────────────
// Framework version — must match packages/core/src/scoring.ts
// ────────────────────────────────────────────────────────────────

const FRAMEWORK_VERSION = '13.0';

// ────────────────────────────────────────────────────────────────
// Mappings
// ────────────────────────────────────────────────────────────────

/** DB cluster check constraint: 'behavioral' | 'financial' | 'ai_compliance' */
type Cluster = 'behavioral' | 'financial' | 'ai_compliance';

function pillarToCluster(pillar: PillarId): Cluster {
  switch (pillar) {
    case 'A':
      return 'behavioral';
    case 'B':
      return 'financial';
    case 'C':
      return 'ai_compliance';
  }
}

/** TierGate → tier_enum value (DB). */
function tierGateToEnum(g: TierGate): 'free_snapshot' | 'starter' | 'pro' | 'enterprise' {
  switch (g) {
    case 'FS':
      return 'free_snapshot';
    case 'ST':
      return 'starter';
    case 'PR':
      return 'pro';
    case 'EN':
      return 'enterprise';
  }
}

const DIM_BY_CODE = new Map(DIMENSIONS.map((d) => [d.code, d]));

function clusterForQuestion(q: Question): Cluster {
  const dim = DIM_BY_CODE.get(q.dimensionCode);
  if (!dim) {
    throw new Error(`Unknown dimension ${q.dimensionCode} on question ${q.id}`);
  }
  return pillarToCluster(dim.pillar);
}

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  // Fail fast if the bank has drifted from the expected shape.
  if (QUESTIONS.length !== 55) {
    console.error(`Expected 55 questions, got ${QUESTIONS.length}. Aborting.`);
    process.exit(2);
  }
  const seenCodes = new Set<DimensionCode>();
  for (const q of QUESTIONS) seenCodes.add(q.dimensionCode);
  if (seenCodes.size !== 13) {
    console.error(`Expected questions across 13 dimensions, got ${seenCodes.size}. Aborting.`);
    process.exit(2);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  console.log(
    `▸ Connected. Seeding ${QUESTIONS.length} questions (framework v${FRAMEWORK_VERSION})…`,
  );

  const upsertSQL = `
    INSERT INTO questions (
      id, dimension_code, cluster, tier_gates, question_type,
      prompt, evidence_hint, scoring_rubric, is_active, framework_version
    )
    VALUES ($1, $2, $3, $4::tier_enum[], $5, $6, $7, $8::jsonb, true, $9)
    ON CONFLICT (id) DO UPDATE SET
      dimension_code    = EXCLUDED.dimension_code,
      cluster           = EXCLUDED.cluster,
      tier_gates        = EXCLUDED.tier_gates,
      question_type     = EXCLUDED.question_type,
      prompt            = EXCLUDED.prompt,
      evidence_hint     = EXCLUDED.evidence_hint,
      scoring_rubric    = EXCLUDED.scoring_rubric,
      is_active         = EXCLUDED.is_active,
      framework_version = EXCLUDED.framework_version,
      updated_at        = now();
  `;

  let inserted = 0;
  try {
    await client.query('BEGIN');

    for (const q of QUESTIONS) {
      const cluster = clusterForQuestion(q);
      const tierGates = q.tierGates.map(tierGateToEnum);
      await client.query(upsertSQL, [
        q.id,
        q.dimensionCode,
        cluster,
        tierGates,
        q.type,
        q.prompt,
        q.evidenceHint ?? null,
        JSON.stringify(q.rubric),
        FRAMEWORK_VERSION,
      ]);
      inserted += 1;
    }

    // Deactivate any row whose id no longer exists in the bank (soft-retire).
    const deactivateSQL = `
      UPDATE questions SET is_active = false, updated_at = now()
      WHERE id NOT IN (${QUESTIONS.map((_, i) => `$${i + 1}`).join(', ')})
        AND is_active = true
      RETURNING id;
    `;
    const deactivated = await client.query<{ id: string }>(
      deactivateSQL,
      QUESTIONS.map((q) => q.id),
    );

    await client.query('COMMIT');

    console.log(`✔ Upserted ${inserted} questions.`);
    if (deactivated.rowCount && deactivated.rowCount > 0) {
      const ids = deactivated.rows.map((r) => r.id).join(', ');
      console.log(`✔ Soft-retired ${deactivated.rowCount} stale question(s): ${ids}`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('✖ Seed failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
