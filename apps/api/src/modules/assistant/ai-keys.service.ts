import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AI_PROVIDERS, keyHint, type AiProviderId } from '@shoppos/shared';
import type { Actor } from '../../common/decorators';
import { config } from '../../config';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Settings row that holds the keys (not a settings section, so it is never sent to the browser). */
const ROW = 'ai-keys';

interface StoredKey {
  iv: string;
  tag: string;
  data: string;
  hint: string;
}

/**
 * Keys for online AI services. They are encrypted (AES-256-GCM, with a key made from the
 * server's secret) before they are stored, are never sent back to the browser (only a hint such
 * as "gsk_…9f3a"), and changes are written to the audit log without the key.
 */
@Injectable()
export class AiKeysService {
  private readonly logger = new Logger('AiKeys');
  private readonly secret = scryptSync(config().jwtSecret, 'shoppos-ai-keys', 32);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async stored(): Promise<Partial<Record<AiProviderId, StoredKey>>> {
    const row = await this.prisma.setting.findUnique({ where: { key: ROW } });
    return (row?.value ?? {}) as Partial<Record<AiProviderId, StoredKey>>;
  }

  private async write(value: Partial<Record<AiProviderId, StoredKey>>, actor: Actor) {
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({
      where: { key: ROW },
      create: { key: ROW, value: json, updatedById: actor.user.id },
      update: { value: json, updatedById: actor.user.id },
    });
  }

  /** "gsk_…9f3a" for each service that has a key. */
  async hints(): Promise<Record<string, string>> {
    const all = await this.stored();
    return Object.fromEntries(Object.entries(all).map(([p, k]) => [p, k?.hint ?? '']));
  }

  async get(provider: AiProviderId): Promise<string | null> {
    const k = (await this.stored())[provider];
    if (!k) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.secret, Buffer.from(k.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(k.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(k.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // A different server secret (e.g. a backup restored on another computer): type it again.
      this.logger.warn(`The saved key for ${provider} cannot be read; it must be entered again.`);
      return null;
    }
  }

  async set(provider: AiProviderId, key: string, actor: Actor) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secret, iv);
    const data = Buffer.concat([cipher.update(key.trim(), 'utf8'), cipher.final()]);
    const all = await this.stored();
    all[provider] = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
      hint: keyHint(key),
    };
    await this.write(all, actor);
    await this.audit.log({
      action: 'AI_KEY_SAVED',
      userId: actor.user.id,
      entityType: 'AiKey',
      entityId: provider,
      summary: `Saved the API key for ${AI_PROVIDERS[provider].name}`,
    });
  }

  async remove(provider: AiProviderId, actor: Actor) {
    const all = await this.stored();
    if (!all[provider]) return;
    delete all[provider];
    await this.write(all, actor);
    await this.audit.log({
      action: 'AI_KEY_REMOVED',
      userId: actor.user.id,
      entityType: 'AiKey',
      entityId: provider,
      summary: `Removed the API key for ${AI_PROVIDERS[provider].name}`,
    });
  }
}
