/**
 * Applies database migrations on the shop computer without the Prisma CLI (which needs
 * platform-specific binaries). It reads the same prisma/migrations folders and records them in
 * Prisma's own _prisma_migrations table, so `prisma migrate` and this runner stay compatible.
 *
 *   node dist/cli/migrate.js
 *
 * Each migration runs in its own transaction: it is applied completely or not at all.
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const LOCK_ID = 72_707_369;

export interface MigrateResult {
  applied: string[];
  skipped: number;
  warnings: string[];
}

export function defaultMigrationsDir() {
  return process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
}

export async function runMigrations(
  databaseUrl: string,
  dir = defaultMigrationsDir(),
  log: (line: string) => void = () => {},
): Promise<MigrateResult> {
  if (!existsSync(dir)) throw new Error(`Migrations folder not found: ${dir}`);
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const result: MigrateResult = { applied: [], skipped: 0, warnings: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )`);
    const { rows } = await client.query<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"');

    const failed = rows.find((r) => !r.finished_at && !r.rolled_back_at);
    if (failed) {
      throw new Error(
        `The database update "${failed.migration_name}" did not finish earlier. Restore the backup made before the update and try again.`,
      );
    }
    const done = new Map(
      rows.filter((r) => r.finished_at).map((r) => [r.migration_name, r.checksum]),
    );

    for (const name of names) {
      const sql = readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const known = done.get(name);
      if (known) {
        if (known !== checksum) result.warnings.push(`${name} was changed after it was applied`);
        result.skipped++;
        continue;
      }
      log(`Applying ${name}…`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count, started_at)
           VALUES ($1, $2, now(), $3, 1, now())`,
          [randomUUID(), checksum, name],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Database update ${name} failed and was undone: ${(err as Error).message}`);
      }
      result.applied.push(name);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end();
  }
  return result;
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  runMigrations(url, defaultMigrationsDir(), (l) => console.log(l))
    .then((r) => {
      for (const w of r.warnings) console.warn(`Warning: ${w}`);
      console.log(
        r.applied.length
          ? `Database updated (${r.applied.length} change(s) applied).`
          : 'Database is already up to date.',
      );
    })
    .catch((err: unknown) => {
      console.error((err as Error).message);
      process.exit(1);
    });
}
