import { z } from 'zod';
import type { Permission } from './permissions';

/**
 * The notifications of the bell, and who gets each. "everyone" means every user who needs it
 * (the permission below: e.g. low stock goes to whoever buys or counts stock), "owners" only
 * admins, "off" nobody. The owner changes this in Settings → Notifications.
 */
export const NOTIFICATION_AUDIENCES = ['everyone', 'owners', 'off'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_TYPES = {
  outOfStock: {
    label: 'Items out of stock',
    hint: 'So nobody promises an item that is not there',
    needs: ['products.view'],
    default: 'everyone',
  },
  lowStock: {
    label: 'Items running low',
    hint: 'For whoever orders or counts stock',
    needs: ['purchases.manage', 'stock.adjust'],
    default: 'everyone',
  },
  dayOpen: {
    label: 'An earlier day is still open',
    hint: 'For whoever closes the day',
    needs: ['cash.register'],
    default: 'everyone',
  },
  backup: {
    label: 'Backup due',
    hint: 'No backup for two days',
    needs: ['backups.manage'],
    default: 'owners',
  },
  voids: {
    label: 'A bill was voided',
    hint: 'Made by someone else',
    needs: [],
    default: 'owners',
  },
  returns: {
    label: 'A return was taken',
    hint: 'Made by someone else',
    needs: [],
    default: 'owners',
  },
  noStockSales: {
    label: 'Sold without stock',
    hint: 'Only when selling without stock is allowed',
    needs: [],
    default: 'owners',
  },
  priceChanges: {
    label: 'Prices changed on a bill, big discounts',
    hint: 'Made by someone else',
    needs: [],
    default: 'owners',
  },
  cashDrawer: {
    label: 'Cash drawer opened, credit above the limit',
    hint: 'Made by someone else',
    needs: [],
    default: 'owners',
  },
  stockChanges: {
    label: 'Stock adjusted',
    hint: 'Counts and corrections by someone else',
    needs: [],
    default: 'owners',
  },
  security: {
    label: 'Wrong passwords, refused approvals, restored backups',
    hint: 'Security',
    needs: [],
    default: 'owners',
  },
} as const satisfies Record<
  string,
  { label: string; hint: string; needs: Permission[]; default: NotificationAudience }
>;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export const notificationSettingsSchema = z.object(
  Object.fromEntries(NOTIFICATION_TYPE_KEYS.map((k) => [k, z.enum(NOTIFICATION_AUDIENCES)])) as {
    [K in NotificationType]: z.ZodEnum<{ everyone: 'everyone'; owners: 'owners'; off: 'off' }>;
  },
);
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS = Object.fromEntries(
  NOTIFICATION_TYPE_KEYS.map((k) => [k, NOTIFICATION_TYPES[k].default]),
) as NotificationSettings;

export const NOTIFICATION_AUDIENCE_LABELS: Record<NotificationAudience, string> = {
  everyone: 'Everyone who needs it',
  owners: 'Owners only',
  off: 'Off',
};
