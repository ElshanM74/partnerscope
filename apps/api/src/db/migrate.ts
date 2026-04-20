/**
 * Applies plain SQL files from /migrations in lexical order, tracking
 * which have been applied in a `_migrations` meta table. Intentionally
 * simple — no drizzle-kit generate/push, because `migrations/` is the
 * source of truth for the prod schema.
 *
 * Usage:
 *   pnpm --filter @partnerscope/api db:migrate
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/api/src/db → ../../../migrations
const MIGRATIONS_DIR = resolve(HERE, '../../../../migrations');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const allFiles = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    const { rows } = await client.query<{ filename: string }>('SELECT filename FROM _migrations');
    const applied = new Set(rows.map((r) => r.filename));

    let run = 0;
    for (const file of allFiles) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`▸ Applying ${file}…`);
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      run += 1;
    }
    console.log(
      run === 0 ? 'Up to date — no migrations to apply.' : `✔ Applied ${run} migration(s).`,
    );
  } catch (err) {
    console.error('✖ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
