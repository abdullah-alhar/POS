import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  HttpStatus,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  BackupDto,
  BackupStatusDto,
  DriveConnectInput,
  RestoreBackupInput,
} from '@marina/shared';
import { runMigrations } from '../../cli/migrate';
import { AppException, badRequest, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { config } from '../../config';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { SettingsService } from '../settings/settings.service';
import {
  BACKUP_FILE_RE,
  backupFileName,
  dumpDatabase,
  parseBackupFileName,
  restoreDatabase,
  toolsAvailable,
  verifyBackup,
  type BackupKind,
} from './backup-core';
import { DriveClient, startDriveSignIn, type DriveSecrets } from './google-drive';

/** Set while a restore runs: every other request gets "please wait" (see bootstrap.ts). */
export const maintenance = { restoring: false };

/** Google Drive keys live in their own settings row, never sent to the browser. */
const DRIVE_KEY = 'backup.drive';
/** Backups made before a restore or an update are kept apart from the daily ones. */
const KEEP_SAFETY_COPIES = 10;

const backupFailed = (message: string) =>
  new AppException(HttpStatus.INTERNAL_SERVER_ERROR, 'BACKUP_FAILED', message);

@Injectable()
export class BackupsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Backups');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private lastSync = 0;
  private lastError: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly cash: CashRegisterService,
  ) {}

  get dir() {
    return process.env.BACKUP_DIR
      ? path.resolve(process.env.BACKUP_DIR)
      : path.join(config().storageDir, 'backups');
  }

  onModuleInit() {
    this.cash.onDayClosed(() => {
      if (!this.settings.get('backup').onDayClose) return;
      void this.create('AUTO').catch((err: Error) =>
        this.logger.error(`Day-close backup failed: ${err.message}`),
      );
    });
    if (config().env === 'test' || process.env.BACKUP_SCHEDULER === 'off') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    // Catch up soon after start-up, e.g. when the laptop was off at backup time.
    setTimeout(() => void this.tick(), 90_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Every minute: the daily backup when it is due, and every 10 minutes the USB / Drive copies. */
  private async tick() {
    if (this.running || maintenance.restoring) return;
    try {
      const s = this.settings.get('backup');
      if (s.dailyAt) {
        const now = new Date();
        const [h, m] = s.dailyAt.split(':').map(Number) as [number, number];
        const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
        if (now >= due && !(await this.hasBackupSince(due))) await this.create('AUTO');
      }
      if (Date.now() - this.lastSync > 10 * 60_000) await this.syncOffsite();
    } catch (err) {
      this.logger.error(`Scheduled backup failed: ${(err as Error).message}`);
    }
  }

  private async hasBackupSince(since: Date) {
    const files = await this.files();
    return files.some((f) => (f.kind === 'AUTO' || f.kind === 'MANUAL') && f.date >= since);
  }

  /** Backup files in a folder, newest first. */
  private async files(dir = this.dir) {
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: { name: string; kind: BackupKind; date: Date; size: number }[] = [];
    for (const name of names) {
      const info = parseBackupFileName(name);
      if (!info) continue;
      const st = await stat(path.join(dir, name)).catch(() => null);
      if (st?.isFile()) out.push({ name, ...info, size: st.size });
    }
    return out.sort((a, b) => b.date.getTime() - a.date.getTime() || b.name.localeCompare(a.name));
  }

  /** Makes a backup now. Only one runs at a time. */
  async create(kind: BackupKind, actor?: Actor): Promise<BackupDto> {
    while (this.running) await this.running.catch(() => undefined);
    const job = this.doCreate(kind, actor);
    this.running = job;
    try {
      return await job;
    } finally {
      this.running = null;
    }
  }

  private async doCreate(kind: BackupKind, actor?: Actor): Promise<BackupDto> {
    if (!toolsAvailable())
      throw backupFailed('pg_dump was not found. Check PG_BIN_DIR in the settings file.');
    const fileName = backupFileName(kind);
    const file = path.join(this.dir, fileName);
    try {
      const size = await dumpDatabase(config().databaseUrl, file);
      const row = await this.prisma.backup.create({
        data: { fileName, path: file, sizeBytes: BigInt(size), kind, status: 'OK' },
      });
      if (actor) {
        await this.audit.log({
          action: 'BACKUP_CREATE',
          userId: actor.user.id,
          entityType: 'Backup',
          entityId: row.id,
          summary: `Made backup ${fileName}`,
        });
      }
      this.lastError = null;
      this.logger.log(`Backup saved: ${file} (${Math.round(size / 1024)} KB)`);
      await this.prune();
      // Copies to USB / Google Drive happen in the background; the backup itself is done.
      void this.syncOffsite().catch(() => undefined);
      return this.toDto(row, true);
    } catch (err) {
      const message = (err as Error).message;
      this.lastError = message;
      await this.prisma.backup
        .create({
          data: { fileName, path: file, kind, status: 'FAILED', error: message.slice(0, 1000) },
        })
        .catch(() => undefined);
      this.logger.error(`Backup failed: ${message}`);
      throw backupFailed(`The backup failed: ${message}`);
    }
  }

  /** Keeps the newest N daily/manual backups and the newest safety copies. */
  private async prune(dir = this.dir) {
    const keep = this.settings.get('backup').keep;
    const files = await this.files(dir);
    const normal = files.filter((f) => f.kind === 'AUTO' || f.kind === 'MANUAL');
    const safety = files.filter((f) => f.kind === 'PRE_RESTORE' || f.kind === 'PRE_UPDATE');
    for (const f of [...normal.slice(keep), ...safety.slice(KEEP_SAFETY_COPIES)]) {
      await rm(path.join(dir, f.name), { force: true }).catch(() => undefined);
    }
  }

  private usbFolder(): { path: string | null; available: boolean } {
    const p = this.settings.get('backup').usbPath.trim();
    if (!p) return { path: null, available: false };
    // The drive letter (E:\) exists only while the USB stick is plugged in.
    return { path: p, available: existsSync(path.parse(path.resolve(p)).root) };
  }

  /** Copies the newest backup to the USB folder and Google Drive when they are available. */
  async syncOffsite(): Promise<{ usb: string; drive: string }> {
    this.lastSync = Date.now();
    const result = { usb: 'not set up', drive: 'not set up' };
    const latest = (await this.files()).find((f) => f.kind === 'AUTO' || f.kind === 'MANUAL');
    if (!latest) return { usb: 'no backup yet', drive: 'no backup yet' };
    const src = path.join(this.dir, latest.name);

    const usb = this.usbFolder();
    if (usb.path) {
      if (!usb.available) result.usb = 'USB drive not plugged in';
      else {
        try {
          await mkdir(usb.path, { recursive: true });
          const dest = path.join(usb.path, latest.name);
          const there = await stat(dest).catch(() => null);
          if (there?.size !== latest.size) {
            await copyFile(src, `${dest}.part`);
            await rm(dest, { force: true });
            await rename(`${dest}.part`, dest);
          }
          await this.prune(usb.path);
          await this.prisma.backup.updateMany({
            where: { fileName: latest.name, status: 'OK' },
            data: { copiedToUsb: true },
          });
          result.usb = 'copied';
        } catch (err) {
          result.usb = `USB copy failed: ${(err as Error).message}`;
          this.logger.warn(result.usb);
        }
      }
    }

    const secrets = await this.driveSecrets();
    if (this.settings.get('backup').driveUpload && secrets?.refreshToken) {
      try {
        const client = new DriveClient(secrets);
        await client.upload(src, this.settings.get('backup').keep);
        if (secrets.folderId) await this.saveDriveSecrets(secrets);
        await this.prisma.backup.updateMany({
          where: { fileName: latest.name, status: 'OK' },
          data: { uploadedToDrive: true },
        });
        result.drive = 'uploaded';
      } catch (err) {
        // No internet is normal in the shop; the next try is in 10 minutes.
        result.drive = `Google Drive upload failed: ${(err as Error).message}`;
        this.logger.warn(result.drive);
      }
    }
    return result;
  }

  async list(): Promise<BackupDto[]> {
    const [files, rows] = await Promise.all([
      this.files(),
      this.prisma.backup.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
    ]);
    const byName = new Map(rows.filter((r) => r.status === 'OK').map((r) => [r.fileName, r]));
    const list: BackupDto[] = files.map((f) => {
      const r = byName.get(f.name);
      return {
        id: r?.id ?? f.name,
        fileName: f.name,
        sizeBytes: f.size,
        kind: f.kind,
        status: 'OK',
        error: null,
        copiedToUsb: r?.copiedToUsb ?? false,
        uploadedToDrive: r?.uploadedToDrive ?? false,
        createdAt: f.date.toISOString(),
        exists: true,
      };
    });
    // Recent failures, so the owner sees when something is wrong.
    const newest = files[0]?.date.getTime() ?? 0;
    for (const r of rows
      .filter((x) => x.status === 'FAILED' && x.createdAt.getTime() > newest)
      .slice(0, 5)) {
      list.push(this.toDto(r, false));
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async usbFiles(): Promise<BackupDto[]> {
    const usb = this.usbFolder();
    if (!usb.path || !usb.available) return [];
    return (await this.files(usb.path)).map((f) => ({
      id: `usb:${f.name}`,
      fileName: f.name,
      sizeBytes: f.size,
      kind: f.kind,
      status: 'OK',
      error: null,
      copiedToUsb: true,
      uploadedToDrive: false,
      createdAt: f.date.toISOString(),
      exists: true,
    }));
  }

  async status(): Promise<BackupStatusDto> {
    const [list, secrets] = await Promise.all([this.list(), this.driveSecrets()]);
    const s = this.settings.get('backup');
    const usb = this.usbFolder();
    return {
      folder: this.dir,
      lastOk:
        list.find((b) => b.status === 'OK' && (b.kind === 'AUTO' || b.kind === 'MANUAL')) ?? null,
      usb: { configured: !!usb.path, path: usb.path, available: usb.available },
      drive: {
        configured: !!secrets?.clientId,
        connected: !!secrets?.refreshToken,
        email: secrets?.email ?? null,
      },
      dailyAt: s.dailyAt,
      keep: s.keep,
      pgDumpFound: toolsAvailable(),
    };
  }

  /** Path of a backup file, checked to be a plain backup name inside the chosen folder. */
  filePath(fileName: string, source: 'local' | 'usb' = 'local') {
    if (!BACKUP_FILE_RE.test(fileName)) throw badRequest('Not a backup file name');
    const dir = source === 'usb' ? this.usbFolder().path : this.dir;
    if (!dir) throw badRequest('No USB folder is set in the backup settings');
    const file = path.join(dir, fileName);
    if (!existsSync(file)) throw notFound('Backup file');
    return file;
  }

  download(fileName: string) {
    return createReadStream(this.filePath(fileName));
  }

  /**
   * Replaces all data with a backup. A safety backup is made first; if the restore fails, the
   * safety backup is put back. Older backups are brought up to date with the migrations.
   */
  async restore(
    input: RestoreBackupInput,
    actor: Actor,
  ): Promise<{ restored: string; safetyBackup: string }> {
    const file = this.filePath(input.fileName, input.source);
    const url = config().databaseUrl;
    await verifyBackup(url, file).catch((err: Error) => {
      throw badRequest(err.message);
    });
    const safety = await this.create('PRE_RESTORE');
    const safetyFile = path.join(this.dir, safety.fileName);
    while (this.running) await this.running.catch(() => undefined);
    maintenance.restoring = true;
    const job = (async () => {
      try {
        await restoreDatabase(url, file);
      } catch (err) {
        this.logger.error(`Restore failed, putting the data back: ${(err as Error).message}`);
        await restoreDatabase(url, safetyFile).catch((e: Error) =>
          this.logger.error(
            `Putting the data back also failed: ${e.message}. Restore ${safety.fileName} by hand.`,
          ),
        );
        await runMigrations(url).catch(() => undefined);
        throw backupFailed(
          `The restore failed and your data was put back as it was. (${(err as Error).message})`,
        );
      }
      const migrated = await runMigrations(url);
      await this.settings.reload();
      await this.audit.log({
        action: 'BACKUP_RESTORE',
        userId:
          (
            await this.prisma.user.findUnique({
              where: { id: actor.user.id },
              select: { id: true },
            })
          )?.id ?? null,
        entityType: 'Backup',
        summary: `Restored backup ${input.fileName}${migrated.applied.length ? ` (updated with ${migrated.applied.length} migration(s))` : ''}`,
        meta: { source: input.source, safetyBackup: safety.fileName },
      });
      // The Backup table now holds the restored copy's history; record the safety copy again.
      await this.prisma.backup.create({
        data: {
          fileName: safety.fileName,
          path: safetyFile,
          sizeBytes: BigInt(safety.sizeBytes),
          kind: 'PRE_RESTORE',
          status: 'OK',
        },
      });
    })();
    this.running = job;
    try {
      await job;
    } finally {
      this.running = null;
      maintenance.restoring = false;
    }
    return { restored: input.fileName, safetyBackup: safety.fileName };
  }

  /* ------------------------------ Google Drive ------------------------------ */

  private async driveSecrets(): Promise<DriveSecrets | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: DRIVE_KEY } });
    return (row?.value as unknown as DriveSecrets | undefined) ?? null;
  }

  private async saveDriveSecrets(value: DriveSecrets | null) {
    if (!value) {
      await this.prisma.setting.deleteMany({ where: { key: DRIVE_KEY } });
      return;
    }
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({
      where: { key: DRIVE_KEY },
      create: { key: DRIVE_KEY, value: json },
      update: { value: json },
    });
  }

  async connectDrive(input: DriveConnectInput, actor: Actor): Promise<{ url: string }> {
    const url = await startDriveSignIn(input.clientId, input.clientSecret, (result) => {
      if (result instanceof Error) {
        this.logger.warn(`Google Drive sign-in failed: ${result.message}`);
        return;
      }
      void (async () => {
        await this.saveDriveSecrets({
          ...input,
          refreshToken: result.refreshToken,
          email: result.email,
          folderId: null,
        });
        const s = this.settings.get('backup');
        if (!s.driveUpload)
          await this.settings.update('backup', { ...s, driveUpload: true }, actor);
        await this.audit.log({
          action: 'BACKUP_DRIVE_CONNECT',
          userId: actor.user.id,
          summary: `Connected Google Drive backups${result.email ? ` (${result.email})` : ''}`,
        });
        this.lastSync = 0;
      })().catch((err: Error) => this.logger.error(err.message));
    });
    return { url };
  }

  async disconnectDrive(actor: Actor) {
    await this.saveDriveSecrets(null);
    const s = this.settings.get('backup');
    if (s.driveUpload) await this.settings.update('backup', { ...s, driveUpload: false }, actor);
    await this.audit.log({
      action: 'BACKUP_DRIVE_DISCONNECT',
      userId: actor.user.id,
      summary: 'Disconnected Google Drive backups',
    });
    return { ok: true };
  }

  get lastFailure() {
    return this.lastError;
  }

  private toDto(
    r: {
      id: string;
      fileName: string;
      sizeBytes: bigint;
      kind: BackupKind;
      status: 'OK' | 'FAILED';
      error: string | null;
      copiedToUsb: boolean;
      uploadedToDrive: boolean;
      createdAt: Date;
    },
    exists: boolean,
  ): BackupDto {
    return {
      id: r.id,
      fileName: r.fileName,
      sizeBytes: Number(r.sizeBytes),
      kind: r.kind,
      status: r.status,
      error: r.error,
      copiedToUsb: r.copiedToUsb,
      uploadedToDrive: r.uploadedToDrive,
      createdAt: r.createdAt.toISOString(),
      exists,
    };
  }
}
