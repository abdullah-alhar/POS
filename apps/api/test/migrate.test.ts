import { readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/cli/migrate';

const ADMIN_URL = (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/postgres$1');
const DB = 'shoppos_migrate_test';
const URL = (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, `/${DB}$1`);
const DIR = path.resolve(__dirname, '..', 'prisma', 'migrations');

async function admin(sql: string) {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await admin(`DROP DATABASE IF EXISTS ${DB}`);
  await admin(`CREATE DATABASE ${DB}`);
});
afterAll(async () => {
  await admin(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
});

describe('migration runner (used on the shop computer)', () => {
  it('builds an empty database, then does nothing the second time', async () => {
    const count = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
    const first = await runMigrations(URL, DIR);
    expect(first.applied).toHaveLength(count);
    const second = await runMigrations(URL, DIR);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toBe(count);
    expect(second.warnings).toEqual([]);

    const c = new Client({ connectionString: URL });
    await c.connect();
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM "User"`);
    await c.end();
    expect(rows[0].n).toBe(0);
  });
});
