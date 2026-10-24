import type { DiscountType, PaymentMethod, PriceMode, Role } from './enums';
import type { Permission } from './permissions';
import type { Cents } from './money';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'APPROVAL_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'TOO_MANY_ATTEMPTS',
  /** No cash session is open: the day must be opened before selling. */
  'DAY_NOT_OPEN',
  /** A price changed since the till loaded it; the till must refresh. */
  'PRICE_CHANGED',
  'PRINTER_ERROR',
  /** A backup is being restored; try again in a minute. */
  'MAINTENANCE',
  'BACKUP_FAILED',
  /** The local AI model is off, not running or not downloaded. */
  'AI_UNAVAILABLE',
  /** The assistant is still answering the previous question. */
  'BUSY',
  'BAD_REQUEST',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Shape of every error the API returns. */
export interface ApiErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  /** Field errors: path → message. */
  fields?: Record<string, string>;
  /** Extra data, e.g. the approval action that is needed. */
  details?: Record<string, unknown>;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  permissions: Permission[];
  avatar: string | null;
}

/** Shown as a tile on the login screen. */
export interface LoginTile {
  id: string;
  fullName: string;
  role: Role;
  avatar: string | null;
}

export interface UserDto {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  permissions: Permission[];
  isActive: boolean;
  avatar: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ApprovalResult {
  token: string;
  approvedBy: { id: string; fullName: string };
  expiresAt: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  parentId: string | null;
  productCount: number;
}

export interface BrandDto {
  id: string;
  name: string;
  productCount: number;
}

export interface TaxRateDto {
  id: string;
  name: string;
  rateBp: number;
  isDefault: boolean;
}

export interface VariantDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  barcodes: string[];
  costPrice: Cents;
  retailPrice: Cents;
  wholesalePrice: Cents;
  stockQty: number;
  reorderLevel: number;
  isActive: boolean;
}

export interface ProductDto {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  taxRateId: string | null;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  taxRate: TaxRateDto | null;
  trackStock: boolean;
  warrantyDays: number;
  trackSerial: boolean;
  isActive: boolean;
  variants: VariantDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItem {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  isActive: boolean;
  trackStock: boolean;
  variantCount: number;
  totalStock: number;
  lowStockVariants: number;
  minRetailPrice: Cents;
  maxRetailPrice: Cents;
  firstBarcode: string | null;
  firstSku: string;
  updatedAt: string;
}

/** One sellable variant in the billing screen's in-memory catalog. */
export interface PosIndexItem {
  variantId: string;
  productId: string;
  /** "Product name – Variant name" */
  name: string;
  sku: string;
  barcodes: string[];
  retailPrice: Cents;
  wholesalePrice: Cents;
  stockQty: number;
  trackStock: boolean;
  taxRateBp: number;
  category: string | null;
  brand: string | null;
  warrantyDays: number;
  trackSerial: boolean;
}

export interface PosIndex {
  version: string;
  items: PosIndexItem[];
}

export interface SaleItemDto {
  id: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  qty: number;
  listPrice: Cents;
  unitPrice: Cents;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: Cents;
  billDiscountShare: Cents;
  taxRateBp: number;
  taxAmount: Cents;
  lineTotal: Cents;
  returnedQty: number;
  warrantyDays: number;
  serialNo: string | null;
}

export interface PaymentDto {
  method: PaymentMethod;
  amount: Cents;
  tendered: Cents | null;
  reference: string | null;
}

export interface UserRef {
  id: string;
  fullName: string;
}

export interface SaleDto {
  id: string;
  clientId: string;
  number: string;
  status: 'COMPLETED' | 'VOIDED';
  priceMode: PriceMode;
  createdAt: string;
  cashier: UserRef;
  customer: { id: string; name: string; phone: string | null } | null;
  subtotal: Cents;
  itemDiscountTotal: Cents;
  billDiscountType: DiscountType | null;
  billDiscountValue: number | null;
  billDiscountAmount: Cents;
  taxTotal: Cents;
  roundingAdjustment: Cents;
  total: Cents;
  paidTotal: Cents;
  changeGiven: Cents;
  note: string | null;
  items: SaleItemDto[];
  payments: PaymentDto[];
  voidedAt: string | null;
  voidedBy: UserRef | null;
  voidApprovedBy: UserRef | null;
  voidReason: string | null;
}

export interface SaleListItem {
  id: string;
  number: string;
  status: 'COMPLETED' | 'VOIDED';
  createdAt: string;
  cashierName: string;
  customerName: string | null;
  itemCount: number;
  total: Cents;
  methods: PaymentMethod[];
}

export interface CheckoutResult {
  sale: SaleDto;
  /** Things the cashier should know, e.g. items sold with no stock left. */
  warnings: string[];
  /** True when this bill was already saved (the same bill was sent again). */
  duplicate: boolean;
}

export interface CashSessionDto {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openedBy: UserRef;
  openingCash: Cents;
}

export interface HeldBillDto {
  id: string;
  label: string | null;
  createdAt: string;
  user: UserRef;
  itemCount: number;
  cart: import('./schemas/sales').HeldCart;
}

export interface PrintResult {
  printed: boolean;
  /** Where it went, e.g. the printer name or the saved file. */
  target: string;
}

export interface StockMovementDto {
  id: string;
  createdAt: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  type: string;
  qtyChange: number;
  qtyAfter: number;
  reference: string | null;
  note: string | null;
  userName: string | null;
}

export interface StockAdjustmentDto {
  id: string;
  number: string;
  reason: string;
  note: string | null;
  createdAt: string;
  user: UserRef;
  approvedBy: UserRef | null;
  items: { variantId: string; name: string; sku: string; qtyChange: number }[];
}

export interface LowStockItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  stockQty: number;
  reorderLevel: number;
  costPrice: Cents;
  retailPrice: Cents;
}

export interface SupplierDto {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  /** Received purchases not yet paid. */
  balance: Cents;
  purchaseCount: number;
}

export interface PurchaseItemDto {
  id: string;
  variantId: string;
  name: string;
  sku: string;
  qty: number;
  unitCost: Cents;
  lineTotal: Cents;
}

export interface PurchaseDto {
  id: string;
  number: string;
  status: 'DRAFT' | 'RECEIVED' | 'CANCELLED';
  supplier: { id: string; name: string };
  supplierInvoiceNo: string | null;
  invoiceDate: string;
  subtotal: Cents;
  discount: Cents;
  total: Cents;
  paidAmount: Cents;
  note: string | null;
  createdAt: string;
  createdBy: UserRef;
  receivedAt: string | null;
  receivedBy: UserRef | null;
  items: PurchaseItemDto[];
}

export interface PurchaseListItem {
  id: string;
  number: string;
  status: 'DRAFT' | 'RECEIVED' | 'CANCELLED';
  supplierName: string;
  supplierInvoiceNo: string | null;
  invoiceDate: string;
  itemCount: number;
  total: Cents;
  paidAmount: Cents;
}

export interface ReturnableItem {
  saleItemId: string;
  variantId: string;
  name: string;
  sku: string;
  soldQty: number;
  returnedQty: number;
  /** Most that can still be returned. */
  returnableQty: number;
  unitPrice: Cents;
  lineTotal: Cents;
}

export interface ReturnableSale {
  saleId: string;
  number: string;
  createdAt: string;
  status: 'COMPLETED' | 'VOIDED';
  customer: { id: string; name: string } | null;
  items: ReturnableItem[];
}

export interface SaleReturnDto {
  id: string;
  number: string;
  createdAt: string;
  sale: { id: string; number: string };
  user: UserRef;
  approvedBy: UserRef | null;
  reason: string;
  refundMethod: string;
  total: Cents;
  taxTotal: Cents;
  items: { name: string; sku: string; qty: number; refundAmount: Cents; restock: boolean }[];
}

export interface ImportRowResult {
  row: number;
  action: 'create' | 'add-variant' | 'update' | 'error';
  name: string;
  message: string;
}

export interface ImportResult {
  committed: boolean;
  rows: ImportRowResult[];
  summary: { create: number; addVariant: number; update: number; error: number };
}

export interface CustomerDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  type: 'RETAIL' | 'WHOLESALE';
  creditLimit: Cents;
  /** What the customer owes the shop. */
  balance: Cents;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CustomerLedgerEntryDto {
  id: string;
  createdAt: string;
  type: string;
  amount: Cents;
  balanceAfter: Cents;
  method: string | null;
  reference: string | null;
  note: string | null;
  userName: string;
}

export interface CashMovementDto {
  id: string;
  type: 'CASH_IN' | 'CASH_OUT';
  amount: Cents;
  reason: string;
  createdAt: string;
  userName: string;
}

export interface CashSessionSummary {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openedBy: UserRef;
  closedAt: string | null;
  closedBy: UserRef | null;
  openingCash: Cents;
  cashSales: Cents;
  cardSales: Cents;
  bankSales: Cents;
  creditSales: Cents;
  customerCashPayments: Cents;
  cashIn: Cents;
  cashOut: Cents;
  cashRefunds: Cents;
  otherRefunds: Cents;
  drawerExpenses: Cents;
  /** Cash that should be in the drawer now (or at closing). */
  expectedCash: Cents;
  countedCash: Cents | null;
  /** counted − expected (negative = short). */
  difference: Cents | null;
  denominations: Record<string, number> | null;
  note: string | null;
  billCount: number;
  voidCount: number;
  returnCount: number;
  totalSales: Cents;
  movements: CashMovementDto[];
}

export interface ExpenseDto {
  id: string;
  number: string;
  date: string;
  category: string;
  amount: Cents;
  paidFrom: 'DRAWER' | 'BANK' | 'OTHER';
  note: string | null;
  createdAt: string;
  userName: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}

/* ----------------------------- Reports ----------------------------- */

export interface SalesReportRow {
  /** First day of the period, YYYY-MM-DD. */
  period: string;
  bills: number;
  /** Bill totals of completed sales (tax included). */
  sales: Cents;
  discounts: Cents;
  returns: Cents;
  /** sales − returns. */
  netSales: Cents;
  tax: Cents;
  /** Cost of the goods sold, less the cost of goods returned. */
  cost: Cents;
  /** netSales − tax − cost. */
  grossProfit: Cents;
  expenses: Cents;
  /** grossProfit − expenses. */
  netProfit: Cents;
}
export interface SalesReport {
  rows: SalesReportRow[];
  totals: Omit<SalesReportRow, 'period'>;
}

export interface ProductReportRow {
  variantId: string;
  name: string;
  sku: string;
  category: string | null;
  qtySold: number;
  sales: Cents;
  profit: Cents;
  stockQty: number;
  lastSoldAt: string | null;
}

export interface StockValueRow {
  category: string;
  items: number;
  qty: number;
  costValue: Cents;
  retailValue: Cents;
}
export interface StockValueReport {
  rows: StockValueRow[];
  totals: Omit<StockValueRow, 'category'>;
}

export interface CashierReportRow {
  userId: string;
  name: string;
  bills: number;
  sales: Cents;
  discounts: Cents;
  voids: number;
  returns: Cents;
}

export interface PaymentReportRow {
  method: string;
  count: number;
  amount: Cents;
}

export interface DashboardDay {
  date: string;
  sales: Cents;
  profit: Cents;
  bills: number;
}
export interface Dashboard {
  today: {
    sales: Cents;
    profit: Cents;
    bills: number;
    avgBill: Cents;
    returns: Cents;
    expenses: Cents;
  };
  yesterday: { sales: Cents; bills: number };
  lowStock: number;
  outOfStock: number;
  owedByCustomers: Cents;
  owedToSuppliers: Cents;
  days: DashboardDay[];
  topToday: { name: string; qty: number; sales: Cents }[];
  paymentsToday: PaymentReportRow[];
  dayOpen: boolean;
}

export interface AuditEntryDto {
  id: string;
  createdAt: string;
  action: string;
  userName: string | null;
  approvedByName: string | null;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
}

/** One saved change of a settings section (from the audit log), to compare or restore. */
export interface SettingsVersionDto {
  id: string;
  createdAt: string;
  userName: string | null;
  section: string;
  summary: string | null;
  /** The section before and after this change. Logos are stored as "[image]". */
  before: unknown;
  after: unknown;
}

/** What the assistant can do right now. */
export interface AssistantStatus {
  mode: 'off' | 'online' | 'local';
  /** Online service id and name, and the model in use. */
  provider: string;
  providerName: string;
  model: string;
  /** An AI can be asked now (key saved, or the local model is downloaded). */
  ready: boolean;
  /** Saved online keys by service, shown as "gsk_…9f3a" (never the key itself). */
  keys: Record<string, string>;
  /** Only filled in by a connection test or for the local model. */
  reachable: boolean;
  models: string[];
  /** Why it is not ready, in words. */
  problem: string | null;
  /** Voice messages can be turned into text by the AI service. */
  voice: boolean;
}

/** Numbers or a table in an answer from "Ask". */
export interface AskCard {
  title?: string;
  /** Numbers to show as tiles. */
  facts?: { label: string; value: string; hint?: string }[];
  table?: { columns: string[]; rows: string[][]; align?: ('left' | 'right')[] };
}

/** An answer from "Ask", the assistant on every page. */
export interface AskAnswer {
  /** The answer in words (may use **bold** and "- " lists). */
  reply: string;
  /** built-in: understood without AI; ai: an AI understood it (the numbers are still ours). */
  source: 'built-in' | 'ai';
  /** The numbers behind the answer. */
  cards?: AskCard[];
  /** Pages to open from the answer. */
  links?: { label: string; to: string }[];
  /** Open this page now. */
  navigate?: string;
  /** Setting changes to show for approval. */
  settings?: { path: string; value: string | number | boolean | string[] }[];
  /** More questions to try. */
  suggestions?: string[];
  /** The AI was asked but could not answer (no internet, no key …). */
  aiProblem?: string;
}

/** What the assistant can do for anyone signed in (no settings needed to know this). */
export interface AssistantAbilities {
  /** An AI is switched on (it may still fail, e.g. without internet). */
  ai: boolean;
  /** Voice messages are turned into text by the AI service (otherwise by the browser). */
  voice: boolean;
}

/* ----------------------------- Backups ----------------------------- */

export interface BackupDto {
  id: string;
  fileName: string;
  sizeBytes: number;
  kind: 'AUTO' | 'MANUAL' | 'PRE_RESTORE' | 'PRE_UPDATE';
  status: 'OK' | 'FAILED';
  error: string | null;
  copiedToUsb: boolean;
  uploadedToDrive: boolean;
  createdAt: string;
  /** The file is still on disk. */
  exists: boolean;
}
export interface BackupStatusDto {
  folder: string;
  lastOk: BackupDto | null;
  usb: { configured: boolean; path: string | null; available: boolean };
  drive: { configured: boolean; connected: boolean; email: string | null };
  /** Time of the daily automatic backup, HH:MM. */
  dailyAt: string;
  keep: number;
  pgDumpFound: boolean;
}
