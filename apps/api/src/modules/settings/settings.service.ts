import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMAS,
  type AllSettings,
  type PublicSettings,
  receiptLayoutFromLegacy,
  type SettingsSection,
} from '@shoppos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../../common/decorators';
import type { Prisma } from '../../generated/prisma/client';

/** Settings are read on almost every request, so they are kept in memory. */
@Injectable()
export class SettingsService implements OnModuleInit {
  private cache: AllSettings = structuredClone(DEFAULT_SETTINGS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  async reload() {
    const rows = await this.prisma.setting.findMany();
    const next = structuredClone(DEFAULT_SETTINGS);
    for (const row of rows) {
      if (!(row.key in SETTINGS_SCHEMAS)) continue;
      const section = row.key as SettingsSection;
      // Merge over defaults so new fields added in an update get a sensible value.
      let value = row.value as Record<string, unknown>;
      // Receipts used to be switches and texts; turn an old one into a design once.
      if (section === 'receipt' && !Array.isArray(value.layout)) {
        value = { ...value, layout: receiptLayoutFromLegacy(value) };
      }
      const merged = { ...DEFAULT_SETTINGS[section], ...value };
      const parsed = SETTINGS_SCHEMAS[section].safeParse(merged);
      if (parsed.success) (next as Record<SettingsSection, unknown>)[section] = parsed.data;
    }
    this.cache = next;
  }

  all(): AllSettings {
    return this.cache;
  }

  get<K extends SettingsSection>(section: K): AllSettings[K] {
    return this.cache[section];
  }

  public(): PublicSettings {
    const { branding, shop, pos, tax, printer, approvals } = this.cache;
    return {
      branding,
      shop: { name: shop.name },
      printer: { mode: printer.mode, openDrawerOnCash: printer.openDrawerOnCash },
      approvals: {
        cashierMaxDiscountBp: approvals.cashierMaxDiscountBp,
        requireApprovalFor: approvals.requireApprovalFor,
      },
      pos,
      tax: { pricesIncludeTax: tax.pricesIncludeTax, vatRegistered: tax.vatRegistered },
    };
  }

  async update<K extends SettingsSection>(section: K, value: AllSettings[K], actor: Actor) {
    const before = this.cache[section];
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: section },
        create: { key: section, value: value as Prisma.InputJsonValue, updatedById: actor.user.id },
        update: { value: value as Prisma.InputJsonValue, updatedById: actor.user.id },
      });
      await this.audit.log(
        {
          action: 'SETTINGS_UPDATE',
          userId: actor.user.id,
          entityType: 'Setting',
          entityId: section,
          summary: `Changed ${section} settings`,
          before: hideImages(before),
          after: hideImages(value),
        },
        tx,
      );
    });
    this.cache = { ...this.cache, [section]: value };
    return value;
  }
}

/** Keep big logo images out of the audit log. */
function hideImages(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      typeof v === 'string' && v.startsWith('data:image/') ? '[image]' : v,
    ]),
  );
}
