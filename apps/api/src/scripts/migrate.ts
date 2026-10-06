/**
 * Migration runner.
 *
 * Applies every .sql file in database/migrations in filename order, once,
 * tracked in a schema_migrations table. Idempotent: re-running is a no-op.
 *
 * Uses the DATABASE_URL directly rather than TypeORM's migration API because
 * these migrations are plain SQL by design — the schema is reviewable
 * independently of the application code.
 *
 * Two entry points share the same logic:
 *
 *   - `pnpm db:migrate` runs this file as a script (see `main()` below).
 *   - The Vercel function imports `runMigrations()` and calls it once per
 *     cold start (see `vercel.ts`), because a production database has no
 *     other opportunity to receive the schema.
 *
 * Failures throw (or exit 1 in the CLI) instead of calling `process.exit()`
 * directly, so the serverless caller can decide what a failed migration means
 * for the rest of the boot.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '../../../../database/migrations');

/**
 * Apply every pending migration to the database behind `connectionString`.
 *
 * Each migration runs in its own transaction: a failure rolls back that file
 * only, leaving prior migrations intact. A failure rejects so callers can
 * log it and continue (the serverless boot) or exit non-zero (the CLI).
 */
export async function runMigrations(connectionString: string): Promise<void> {
  // Mirror the TypeORM config in app.module.ts: production Postgres sits
  // behind TLS, so without this the cold-start migration dies with
  // "server does not support SSL connections"-style errors the app itself
  // never sees. Two escape hatches keep the other cases working: a URL that
  // carries its own sslmode=... wins (pg merges the parsed URL over the
  // explicit option), and local docker-compose Postgres — SSL off — is
  // detected and stays on plain TCP.
  const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(connectionString);
  const client = new Client({
    connectionString,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });

  try {
    await client.connect();
    console.log('[migrations] Connected to Postgres');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (
        await client.query<{ name: string }>('SELECT name FROM schema_migrations')
      ).rows.map((row) => row.name),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    let count = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  - ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${file}: ${(err as Error).message}`);
        throw err;
      }
    }

    console.log(
      count === 0 ? '[migrations] Database is up to date' : `[migrations] Applied ${count} migration(s)`,
    );
  } finally {
    await client.end();
  }
}

/**
 * Load .env into process.env.
 *
 * This script runs outside Nest, so `ConfigModule.forRoot()` — the only thing
 * that loaded .env for the app — never executes. Reading process.env directly
 * therefore saw nothing, and the run failed with "DATABASE_URL is not set"
 * even though a perfectly good .env was sitting in the repo root.
 *
 * `process.loadEnvFile` is built into Node 20.12+ / 21.7+, so this needs no
 * dotenv dependency (pnpm's isolated store does not expose @nestjs/config's
 * copy of dotenv to this package).
 *
 * A missing file is not an error: DATABASE_URL may legitimately be exported
 * by the environment instead, which is what CI and docker-compose do.
 * Values already present in the environment win over the file.
 */
function loadEnvFile(): void {
  const candidates = [
    resolve(__dirname, '../../../../.env'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];

  for (const path of candidates) {
    try {
      process.loadEnvFile(path);
      return;
    } catch {
      // Try the next candidate.
    }
  }
}

async function main(): Promise<void> {
  loadEnvFile();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    console.error('Set it in .env at the repo root, or export it before running.');
    process.exit(1);
  }

  await runMigrations(connectionString);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
