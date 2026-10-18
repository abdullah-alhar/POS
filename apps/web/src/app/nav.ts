import {
  Contact,
  House,
  Package,
  ReceiptText,
  ScanBarcode,
  Settings,
  ShoppingCart,
  ChartColumn,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@shoppos/shared';

export interface NavPage {
  to: string;
  label: string;
  permission?: Permission;
}

/** One sidebar entry. Entries with several pages show them as tabs at the top of the page. */
export interface NavItem {
  label: string;
  icon: LucideIcon;
  pages: NavPage[];
}

/** The sidebar: few entries, so it is easy to find your way (also searched by Ctrl+K). */
export const NAV: NavItem[] = [
  {
    label: 'Home',
    icon: House,
    pages: [{ to: '/dashboard', label: 'Home', permission: 'reports.view' }],
  },
  { label: 'Billing', icon: ScanBarcode, pages: [{ to: '/billing', label: 'Billing' }] },
  {
    label: 'Sales',
    icon: ReceiptText,
    pages: [
      { to: '/sales', label: 'Bills', permission: 'sales.create' },
      { to: '/returns', label: 'Returns', permission: 'returns.create' },
    ],
  },
  {
    label: 'Customers',
    icon: Contact,
    pages: [{ to: '/customers', label: 'Customers', permission: 'customers.manage' }],
  },
  {
    label: 'Products',
    icon: Package,
    pages: [
      { to: '/products', label: 'Products', permission: 'products.view' },
      { to: '/stock', label: 'Stock', permission: 'products.view' },
      { to: '/labels', label: 'Barcode labels', permission: 'products.view' },
      { to: '/catalog', label: 'Categories & brands', permission: 'products.view' },
    ],
  },
  {
    label: 'Purchases',
    icon: ShoppingCart,
    pages: [
      { to: '/purchases', label: 'Purchases', permission: 'purchases.manage' },
      { to: '/suppliers', label: 'Suppliers', permission: 'purchases.manage' },
    ],
  },
  {
    label: 'Cash',
    icon: Wallet,
    pages: [
      { to: '/cash', label: 'Cash register', permission: 'cash.register' },
      { to: '/expenses', label: 'Expenses', permission: 'expenses.manage' },
    ],
  },
  {
    label: 'Reports',
    icon: ChartColumn,
    pages: [{ to: '/reports', label: 'Reports', permission: 'reports.view' }],
  },
  {
    label: 'Settings',
    icon: Settings,
    pages: [
      { to: '/settings', label: 'Settings', permission: 'settings.manage' },
      { to: '/users', label: 'Users', permission: 'users.manage' },
      { to: '/backups', label: 'Backups', permission: 'backups.manage' },
      { to: '/audit', label: 'Audit log', permission: 'audit.view' },
    ],
  },
];

/** Is `path` one of the item's pages (or below one, e.g. /products/123)? */
export const pageMatches = (page: NavPage, path: string) =>
  path === page.to || path.startsWith(`${page.to}/`);
