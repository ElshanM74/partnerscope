/**
 * Shared Drizzle + pg Pool client.
 *
 * Single pool for the whole API process. Import from routes/services:
 *   import { db } from '../db/client.js';
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { env } from '../config/env.js';
import * as schema from './schema.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
