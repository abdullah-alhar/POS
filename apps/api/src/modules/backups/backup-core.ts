/**
 * Database backup and restore with PostgreSQL's own tools (pg_dump / pg_restore).
 * No Nest here, so the update script's CLI can use it too.
 *
 * Where the tools are:
 *   PG_BIN_DIR           folder with pg_dump.exe / pg_restore.exe (set by the Windows installer)
 *   PG_DOCKER_CONTAINER  development only: run the tools inside this Docker container
 * Otherwise pg_dump / pg_restore are taken from PATH.
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export type BackupKind = 'AUTO' | 'MANUAL' | 'PRE_RESTORE' | 'PRE_UPDATE';

const KIND_SUFFIX: Record<BackupKind, string> = {
  AUTO: 'auto',
  MANUAL: 'manual',
  PRE_RESTORE: 'before-restore',
  PRE_UPDATE: 'before-update',
};

/** shoppos_2026-10-14_2130_auto.dump (local time, sorts by date). */
export function backupFileName(kind: BackupKind, now = new Date()) {
  const p = (v: number) => String(v).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `shoppos_${stamp}_${KIND_SUFFIX[kind]}.dump`;
}

export const BACKUP_FILE_RE =
  /^shoppos_(\d{4}-\d{2}-\d{2})_(\d{4,6})_(auto|manual|before-restore|before-update)\.dump$/;

export function parseBackupFileName(name: string): { kind: BackupKind; date: Date } | null {
  const m = BACKUP_FILE_RE.exec(name);
  if (!m) return null;
  const kind = (Object.keys(KIND_SUFFIX) as BackupKind[]).find((k) => KIND_SUFFIX[k] === m[3])!;
  const [y, mo, d] = m[1]!.split('-').map(Number) as [number, number, number];
  const t = m[2]!.padEnd(6, '0');
  return {
    kind,
    date: new Date(
      y,
      mo - 1,
      d,
      Number(t.slice(0, 2)),
      Number(t.slice(2, 4)),
      Number(t.slice(4, 6)),
    ),
  };
}

interface Conn {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export function parseDatabaseUrl(url: string): Conn {
  const u = new URL(url);
  return {
    host: u.hostname || 'localhost',
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

function tool(name: 'pg_dump' | 'pg_restore' | 'psql') {
  const dir = process.env.PG_BIN_DIR;
  if (dir) return path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
  return name;
}

/** pg_dump/pg_restore can be found (or Docker is used in development). */
export function toolsAvailable(): boolean {
  if (process.env.PG_DOCKER_CONTAINER) return true;
  const dir = process.env.PG_BIN_DIR;
  if (dir) return existsSync(tool('pg_dump'));
  return true; // on PATH; a missing tool shows up as a clear error when used
}

/** The command line for a PostgreSQL tool, either directly or through `docker exec`. */
function command(name: 'pg_dump' | 'pg_restore' | 'psql', conn: Conn, args: string[]) {
  const container = process.env.PG_DOCKER_CONTAINER;
  const connArgs = container
    ? ['-h', 'localhost', '-p', '5432', '-U', conn.user, '-d', conn.database]
    : ['-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', conn.database];
  if (container) {
    return {
      cmd: 'docker',
      args: [
        'exec',
        '-i',
        '-e',
        `PGPASSWORD=${conn.password}`,
        container,
        name,
        ...connArgs,
        ...args,
      ],
    };
  }
  return { cmd: tool(name), args: [...connArgs, ...args] };
}

/** Runs a tool. stdout goes to `out` (a file) when given; stdin comes from `input` when given. */
async function run(
  name: 'pg_dump' | 'pg_restore' | 'psql',
  conn: Conn,
  args: string[],
  io: { out?: string; input?: string } = {},
): Promise<string> {
  const { cmd, args: argv } = command(name, conn, args);
  const child = spawn(cmd, argv, {
    env: { ...process.env, PGPASSWORD: conn.password },
    stdio: [io.input ? 'pipe' : 'ignore', io.out ? 'pipe' : 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  let stdout = '';
  child.stderr!.on('data', (d: Buffer) => {
    if (stderr.length < 20_000) stderr += d.toString();
  });
  const done = new Promise<number>((resolve, reject) => {
    child.on('error', (err: NodeJS.ErrnoException) =>
      reject(
        err.code === 'ENOENT'
          ? new Error(`${name} was not found. Check PG_BIN_DIR in the settings file (${cmd}).`)
          : err,
      ),
    );
    child.on('close', (code) => resolve(code ?? 1));
  });
  const tasks: Promise<unknown>[] = [done];
  if (io.out) tasks.push(pipeline(child.stdout!, createWriteStream(io.out)));
  else child.stdout!.on('data', (d: Buffer) => (stdout += d.toString()));
  if (io.input) tasks.push(pipeline(createReadStream(io.input), child.stdin!));
  const [code] = (await Promise.all(tasks)) as [number];
  if (code !== 0) {
    const msg = stderr.trim().split('\n').slice(-5).join(' ').trim();
    throw new Error(`${name} failed${msg ? `: ${msg}` : ` (exit code ${code})`}`);
  }
  return stdout;
}

/** Writes a compressed backup of the whole database to `file`. Returns its size. */
export async function dumpDatabase(databaseUrl: string, file: string): Promise<number> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  try {
    await run(
      'pg_dump',
      parseDatabaseUrl(databaseUrl),
      ['--format=custom', '--compress=6', '--no-owner', '--no-acl'],
      { out: tmp },
    );
    const size = (await stat(tmp)).size;
    if (size < 1024) throw new Error('The backup file is unexpectedly small');
    await rename(tmp, file);
    return size;
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Checks that a file is a readable backup (lists its contents without restoring). */
export async function verifyBackup(databaseUrl: string, file: string): Promise<void> {
  const out = await run('pg_restore', parseDatabaseUrl(databaseUrl), ['--list'], {
    input: file,
  }).catch((err: Error) => {
    throw new Error(`This is not a ShopPOS backup file (${err.message})`);
  });
  if (!/TABLE DATA public "?Sale"?/.test(out))
    throw new Error('This backup does not contain ShopPOS data');
}

/** Drops the app's tables, types, functions and extensions (works without owning the schema). */
export const CLEAR_PUBLIC_SCHEMA = `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT e.extname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE n.nspname = 'public' LOOP
    EXECUTE format('DROP EXTENSION IF EXISTS %I CASCADE', r.extname);
  END LOOP;
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.viewname);
  END LOOP;
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.sequence_name);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.fn || ' CASCADE';
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd') LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END $$;`;

/**
 * Replaces everything in the database with the backup. The caller makes a backup first.
 * Everything in the public schema is dropped first, so tables added by newer versions do not get
 * in the way; migrations then bring an older backup up to the current version.
 */
export async function restoreDatabase(databaseUrl: string, file: string): Promise<void> {
  const conn = parseDatabaseUrl(databaseUrl);
  await run('psql', conn, ['-v', 'ON_ERROR_STOP=1', '-q', '-c', CLEAR_PUBLIC_SCHEMA]);
  await run(
    'pg_restore',
    conn,
    ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'],
    { input: file },
  );
}
