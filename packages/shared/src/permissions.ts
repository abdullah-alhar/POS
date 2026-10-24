import type { Role } from './enums';

export const PERMISSIONS = {
  'sales.create': 'Make sales',
  'sales.view': 'See the Sales page (past bills)',
  'sales.viewAll': 'See bills made by other users',
  'sales.void': 'Void bills without asking an admin',
  'returns.create': 'Take returns and give refunds',
  'products.view': 'View products',
  'products.manage': 'Add and edit products',
  'stock.adjust': 'Adjust stock',
  'purchases.manage': 'Suppliers and purchases',
  'customers.manage': 'Add and edit customers',
  'customers.credit': 'Sell on credit and take customer payments',
  'cash.register': 'Open and close the day, cash in and out',
  'expenses.manage': 'Record shop expenses',
  'drawer.open': 'Open the cash drawer without asking an admin',
  'reports.view': 'View reports and dashboard',
  'users.manage': 'Manage users',
  'settings.manage': 'Change settings',
  'audit.view': 'View the audit log',
  'backups.manage': 'Backups and restore',
  'branding.manage': 'Change the logo, app name and colours',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Only the Super Admin (app maker) has these; they can never be given to anyone else. */
export const SUPER_ADMIN_ONLY_PERMISSIONS: Permission[] = ['branding.manage'];

/** Permissions an admin can tick for a cashier. */
export const ASSIGNABLE_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(p),
);

/** What a new cashier can do. The admin can tick more boxes per user. */
export const DEFAULT_CASHIER_PERMISSIONS: Permission[] = [
  'sales.create',
  'sales.view',
  'returns.create',
  'products.view',
  'customers.manage',
  'cash.register',
];

/** The permission boxes on the user form, by the part of the shop they belong to. */
export const PERMISSION_GROUPS: { title: string; permissions: Permission[] }[] = [
  {
    title: 'Selling',
    permissions: [
      'sales.create',
      'sales.view',
      'sales.viewAll',
      'sales.void',
      'returns.create',
      'drawer.open',
    ],
  },
  {
    title: 'Products and stock',
    permissions: ['products.view', 'products.manage', 'stock.adjust', 'purchases.manage'],
  },
  { title: 'Customers', permissions: ['customers.manage', 'customers.credit'] },
  { title: 'Money', permissions: ['cash.register', 'expenses.manage', 'reports.view'] },
  {
    title: 'Running the shop',
    permissions: ['settings.manage', 'users.manage', 'audit.view', 'backups.manage'],
  },
];

/** What a user can really do: Super Admin everything, Admin everything but branding. */
export function effectivePermissions(role: Role, stored: readonly string[]): Permission[] {
  if (role === 'SUPER_ADMIN') return ALL_PERMISSIONS;
  if (role === 'ADMIN') return ASSIGNABLE_PERMISSIONS;
  return ASSIGNABLE_PERMISSIONS.filter((p) => stored.includes(p));
}

export function hasPermission(
  user: { role: Role; permissions: readonly string[] },
  permission: Permission,
): boolean {
  return effectivePermissions(user.role, user.permissions).includes(permission);
}

/**
 * Actions that need an admin to type their PIN when a cashier does them.
 * An admin (or Super Admin) doing the action themselves does not need a second approval.
 */
export const APPROVAL_ACTIONS = {
  VOID_SALE: 'Void a bill',
  LARGE_DISCOUNT: 'Give a discount above the cashier limit',
  PRICE_CHANGE: 'Change a price',
  REFUND: 'Refund a return',
  CASH_OUT: 'Take cash out of the drawer',
  STOCK_ADJUST: 'Adjust stock',
  OPEN_DRAWER: 'Open the cash drawer',
  EXIT_POS: 'Close the full-screen POS',
  CREDIT_LIMIT: "Sell on credit above the customer's limit",
} as const;

export type ApprovalAction = keyof typeof APPROVAL_ACTIONS;
export const ALL_APPROVAL_ACTIONS = Object.keys(APPROVAL_ACTIONS) as ApprovalAction[];

/** Header the browser uses to send an approval token with the protected request. */
export const APPROVAL_HEADER = 'x-approval-token';
