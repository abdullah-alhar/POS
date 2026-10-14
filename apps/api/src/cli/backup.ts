/**
 * Database backup and restore from the command line (used by update.ps1).
 *
 *   node dist/cli/backup.js                    backup before an update (prints the file path last)
 *   node dist/cli/backup.js manual             a normal backup
 *   node dist/cli/backup.js restore <file>     put a backup back (replaces all data!)
 */
import 'dotenv/config';
import path from 'node:path';
import {
  backupFileName,
  dumpDatabase,
  restoreDatabase,
  verifyBackup,
} from '../modules/backups/backup-core';
import { runMigrations } from './migrate';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is missing');
  const [command, arg] = process.argv.slice(2);

  if (command === 'restore') {
    if (!arg) throw new Error('Give the backup file to restore');
    const file = path.resolve(arg);
    await verifyBackup(url, file);
    await restoreDatabase(url, file);
    // Brings an older backup up to the migrations of the app that is installed now.
    const migrated = await runMigrations(url);
    console.log(
      `Restored ${file}${migrated.applied.length ? ` and applied ${migrated.applied.length} update(s)` : ''}`,
    );
    return;
  }

  const kind = command === 'manual' ? 'MANUAL' : 'PRE_UPDATE';
  const dir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(path.resolve(process.env.STORAGE_DIR ?? './storage'), 'backups');
  const file = path.join(dir, backupFileName(kind));
  const size = await dumpDatabase(url, file);
  console.log(`Backup saved (${Math.round(size / 1024)} KB):`);
  console.log(file);
}

main().catch((err: Error) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
