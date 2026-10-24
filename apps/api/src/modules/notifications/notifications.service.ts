import { Injectable } from '@nestjs/common';
import { hasPermission, type NotificationDto, type NotificationsDto } from '@shoppos/shared';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

const DAY = 86_400_000;
/** A backup older than this is worth a reminder. */
const BACKUP_DUE = 2 * DAY;
/** Events from the audit log shown to owners, newest first, from the last week. */
const EVENT_DAYS = 7;

/** Audit events an owner wants to hear about, with how serious they are and where to look. */
const EVENTS: Record<string, { level: NotificationDto['level']; title: string; link: string }> = {
  SALE_VOID: { level: 'danger', title: 'A bill was voided', link: '/sales' },
  SALE_RETURN: { level: 'warning', title: 'A return was taken', link: '/returns' },
  SALE_NO_STOCK: { level: 'warning', title: 'Sold without stock', link: '/stock' },
  PRICE_CHANGE: { level: 'info', title: 'A price was changed on a bill', link: '/audit' },
  LARGE_DISCOUNT: { level: 'info', title: 'A big discount was given', link: '/audit' },
  CREDIT_LIMIT: { level: 'warning', title: 'Sold above a credit limit', link: '/customers' },
  DRAWER_OPEN: { level: 'info', title: 'The cash drawer was opened', link: '/audit' },
  STOCK_ADJUST: { level: 'info', title: 'Stock was adjusted', link: '/stock' },
  APPROVAL_DENIED: { level: 'warning', title: 'An approval was refused', link: '/audit' },
  LOGIN_FAILED: { level: 'warning', title: 'A wrong password or PIN was typed', link: '/audit' },
  BACKUP_RESTORE: { level: 'danger', title: 'A backup was restored', link: '/backups' },
};

/**
 * The bell: things to fix now (stock out or low, a day left open, no recent backup) and, for
 * owners, what others did that matters (voids, returns, sales without stock …). Each user sees
 * only what their permissions allow; "read" is everything before they last opened the bell.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async list(actor: Actor): Promise<NotificationsDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.user.id },
      select: { notificationsSeenAt: true },
    });
    const seen = user?.notificationsSeenAt?.getTime() ?? 0;
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(actor.user, p);
    const items: Omit<NotificationDto, 'unread'>[] = [];

    if (can('products.view')) items.push(...(await this.stockAlerts()));
    if (can('cash.register')) items.push(...(await this.dayAlerts()));
    if (can('backups.manage')) items.push(...(await this.backupAlerts()));
    if (can('audit.view')) items.push(...(await this.events(actor.user.id)));

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

  private async stockAlerts(): Promise<Omit<NotificationDto, 'unread'>[]> {
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
    if (out.length)
      res.push({
        id: `out-of-stock:${out.length}:${at}`,
        kind: 'alert',
        level: 'danger',
        title: `${out.length} item${out.length === 1 ? ' is' : 's are'} out of stock`,
        detail: names(out),
        at,
        link: '/stock',
      });
    const running = low.filter((i) => i.stockQty > 0);
    if (running.length)
      res.push({
        id: `low-stock:${running.length}:${at}`,
        kind: 'alert',
        level: 'warning',
        title: `${running.length} item${running.length === 1 ? ' is' : 's are'} running low`,
        detail: names(running),
        at,
        link: '/stock',
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

  private async events(selfId: string): Promise<Omit<NotificationDto, 'unread'>[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: { in: Object.keys(EVENTS) },
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
