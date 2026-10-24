import { Injectable } from '@nestjs/common';
import {
  hasPermission,
  isAdminRole,
  NOTIFICATION_TYPES,
  type NotificationDto,
  type NotificationsDto,
  type NotificationType,
} from '@shoppos/shared';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { SettingsService } from '../settings/settings.service';

const DAY = 86_400_000;
/** A backup older than this is worth a reminder. */
const BACKUP_DUE = 2 * DAY;
/** Events from the audit log shown to owners, newest first, from the last week. */
const EVENT_DAYS = 7;

/** Audit events an owner wants to hear about, with how serious they are and where to look. */
const EVENTS: Record<
  string,
  { type: NotificationType; level: NotificationDto['level']; title: string; link: string }
> = {
  SALE_VOID: { type: 'voids', level: 'danger', title: 'A bill was voided', link: '/sales' },
  SALE_RETURN: { type: 'returns', level: 'warning', title: 'A return was taken', link: '/returns' },
  SALE_NO_STOCK: {
    type: 'noStockSales',
    level: 'warning',
    title: 'Sold without stock',
    link: '/products?low=1',
  },
  PRICE_CHANGE: {
    type: 'priceChanges',
    level: 'info',
    title: 'A price was changed on a bill',
    link: '/audit',
  },
  LARGE_DISCOUNT: {
    type: 'priceChanges',
    level: 'info',
    title: 'A big discount was given',
    link: '/audit',
  },
  CREDIT_LIMIT: {
    type: 'cashDrawer',
    level: 'warning',
    title: 'Sold above a credit limit',
    link: '/customers',
  },
  DRAWER_OPEN: {
    type: 'cashDrawer',
    level: 'info',
    title: 'The cash drawer was opened',
    link: '/audit',
  },
  STOCK_ADJUST: {
    type: 'stockChanges',
    level: 'info',
    title: 'Stock was adjusted',
    link: '/products',
  },
  APPROVAL_DENIED: {
    type: 'security',
    level: 'warning',
    title: 'An approval was refused',
    link: '/audit',
  },
  LOGIN_FAILED: {
    type: 'security',
    level: 'warning',
    title: 'A wrong password or PIN was typed',
    link: '/audit',
  },
  BACKUP_RESTORE: {
    type: 'security',
    level: 'danger',
    title: 'A backup was restored',
    link: '/backups',
  },
};

/**
 * The bell: things to fix now (stock out or low, a day left open, no recent backup) and what
 * others did that matters (voids, returns, sales without stock …). Each kind goes to the people
 * chosen in Settings → Notifications and who need it (low stock to whoever orders or counts
 * stock …). "Read" is everything before the user last opened the bell.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly settings: SettingsService,
  ) {}

  /** Does this user get this kind of notification (Settings → Notifications, and their rights)? */
  private wants(actor: Actor, type: NotificationType): boolean {
    const rule = this.settings.get('notifications')[type];
    if (rule === 'off') return false;
    if (rule === 'owners') return isAdminRole(actor.user.role);
    const needs = NOTIFICATION_TYPES[type].needs as readonly Parameters<typeof hasPermission>[1][];
    return !needs.length || needs.some((p) => hasPermission(actor.user, p));
  }

  async list(actor: Actor): Promise<NotificationsDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.user.id },
      select: { notificationsSeenAt: true },
    });
    const seen = user?.notificationsSeenAt?.getTime() ?? 0;
    const wants = (t: NotificationType) => this.wants(actor, t);
    const items: Omit<NotificationDto, 'unread'>[] = [];

    if (wants('outOfStock') || wants('lowStock'))
      items.push(...(await this.stockAlerts(wants('outOfStock'), wants('lowStock'))));
    if (wants('dayOpen')) items.push(...(await this.dayAlerts()));
    if (wants('backup')) items.push(...(await this.backupAlerts()));
    const eventTypes = Object.entries(EVENTS)
      .filter(([, e]) => wants(e.type))
      .map(([action]) => action);
    if (eventTypes.length) items.push(...(await this.events(actor.user.id, eventTypes)));

    const sorted = items
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((n) => ({ ...n, unread: new Date(n.at).getTime() > seen }));
    return { items: sorted, unread: sorted.filter((n) => n.unread).length };
  }

  async markSeen(actor: Actor) {
    await this.prisma.user.update({
      where: { id: actor.user.id },
      data: { notificationsSeenAt: new Date() },
    });
  }

  private async stockAlerts(
    showOut: boolean,
    showLow: boolean,
  ): Promise<Omit<NotificationDto, 'unread'>[]> {
    const low = await this.inventory.lowStock();
    if (!low.length) return [];
    // When it last changed: the newest stock movement or edit of these items.
    const ids = { in: low.map((i) => i.variantId) };
    const [moved, edited] = await Promise.all([
      this.prisma.stockMovement.aggregate({ where: { variantId: ids }, _max: { createdAt: true } }),
      this.prisma.productVariant.aggregate({ where: { id: ids }, _max: { updatedAt: true } }),
    ]);
    const times = [moved._max.createdAt, edited._max.updatedAt].filter((d): d is Date => !!d);
    const at = new Date(Math.max(...times.map((d) => d.getTime()))).toISOString();
    const out = low.filter((i) => i.stockQty <= 0);
    const names = (list: typeof low) =>
      list
        .slice(0, 3)
        .map((i) => i.name)
        .join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
    const res: Omit<NotificationDto, 'unread'>[] = [];
    if (showOut && out.length)
      res.push({
        id: `out-of-stock:${out.length}:${at}`,
        kind: 'alert',
        level: 'danger',
        title: `${out.length} item${out.length === 1 ? ' is' : 's are'} out of stock`,
        detail: names(out),
        at,
        link: '/products?low=1',
      });
    const running = low.filter((i) => i.stockQty > 0);
    if (showLow && running.length)
      res.push({
        id: `low-stock:${running.length}:${at}`,
        kind: 'alert',
        level: 'warning',
        title: `${running.length} item${running.length === 1 ? ' is' : 's are'} running low`,
        detail: names(running),
        at,
        link: '/products?low=1',
      });
    return res;
  }

  private async dayAlerts(): Promise<Omit<NotificationDto, 'unread'>[]> {
    const open = await this.prisma.cashSession.findFirst({ where: { status: 'OPEN' } });
    if (!open) return [];
    const opened = open.openedAt;
    const nextMidnight = new Date(opened);
    nextMidnight.setHours(24, 0, 0, 0);
    if (Date.now() < nextMidnight.getTime()) return [];
    return [
      {
        id: `day-open:${open.id}`,
        kind: 'alert',
        level: 'warning',
        title: 'An earlier day is still open',
        detail: `Opened ${opened.toLocaleDateString('en-GB')}. Close it to print the day report.`,
        at: nextMidnight.toISOString(),
        link: '/cash',
      },
    ];
  }

  private async backupAlerts(): Promise<Omit<NotificationDto, 'unread'>[]> {
    const last = await this.prisma.backup.findFirst({
      where: { status: 'OK' },
      orderBy: { createdAt: 'desc' },
    });
    const since = last?.createdAt.getTime() ?? 0;
    if (last && Date.now() - since < BACKUP_DUE) return [];
    const firstUser = last
      ? null
      : await this.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    const due = last ? since + BACKUP_DUE : (firstUser?.createdAt.getTime() ?? Date.now());
    return [
      {
        id: `backup:${last?.id ?? 'none'}`,
        kind: 'alert',
        level: 'danger',
        title: last ? 'No backup for more than two days' : 'No backup has been made yet',
        detail: 'Make a backup so the shop data is safe if the laptop breaks.',
        at: new Date(Math.min(due, Date.now())).toISOString(),
        link: '/backups',
      },
    ];
  }

  private async events(
    selfId: string,
    actions: string[],
  ): Promise<Omit<NotificationDto, 'unread'>[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: { in: actions },
        createdAt: { gte: new Date(Date.now() - EVENT_DAYS * DAY) },
        OR: [{ userId: null }, { userId: { not: selfId } }],
      },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return rows.map((r) => {
      const e = EVENTS[r.action]!;
      return {
        id: `audit:${r.id}`,
        kind: 'event',
        level: e.level,
        title: e.title,
        detail: [r.user?.fullName, r.summary].filter(Boolean).join(': ') || undefined,
        at: r.createdAt.toISOString(),
        link: e.link,
      };
    });
  }
}
