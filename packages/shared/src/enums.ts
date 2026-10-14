/** String unions that mirror the Prisma enums, for use in the browser. */

/**
 * SUPER_ADMIN: the app maker. Can do everything, including branding (logo, colours) for each shop.
 * ADMIN: the shop owner. Everything except branding.
 * CASHIER: only what the admin allows.
 */
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'CASHIER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CASHIER: 'Cashier',
};

/** Admin-level roles: full shop access and can approve cashier actions with their PIN. */
export function isAdminRole(role: Role): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export const PRICE_MODES = ['RETAIL', 'WHOLESALE'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const STOCK_MOVEMENT_TYPES = [
  'OPENING',
  'SALE',
  'SALE_VOID',
  'RETURN',
  'PURCHASE',
  'ADJUSTMENT',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const DISCOUNT_TYPES = ['AMOUNT', 'PERCENT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CREDIT: 'Credit',
};
