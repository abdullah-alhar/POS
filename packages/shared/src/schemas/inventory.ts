import { z } from 'zod';
import { centsSchema, optionalText, pageQuerySchema } from './common';

export const ADJUSTMENT_REASONS = ['COUNT_CORRECTION', 'DAMAGED', 'LOST', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  COUNT_CORRECTION: 'Stock count correction',
  DAMAGED: 'Damaged',
  LOST: 'Lost / stolen',
  OTHER: 'Other',
};

export const stockAdjustmentSchema = z.object({
  reason: z.enum(ADJUSTMENT_REASONS),
  note: optionalText(300),
  items: z
    .array(
      z.object({
        variantId: z.uuid(),
        /** CHANGE: add/remove this many (e.g. -2). COUNT: this is how many were counted. */
        mode: z.enum(['CHANGE', 'COUNT']),
        qty: z.int().min(-1_000_000).max(1_000_000),
      }),
    )
    .min(1, 'Add at least one item')
    .max(500),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

export const STOCK_MOVEMENT_LABELS: Record<string, string> = {
  OPENING: 'Opening stock',
  SALE: 'Sale',
  SALE_VOID: 'Bill voided',
  RETURN: 'Customer return',
  PURCHASE: 'Purchase received',
  ADJUSTMENT: 'Adjustment',
};

export const movementQuerySchema = pageQuerySchema.extend({
  variantId: z.uuid().optional(),
  productId: z.uuid().optional(),
  type: z.enum(['OPENING', 'SALE', 'SALE_VOID', 'RETURN', 'PURCHASE', 'ADJUSTMENT']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type MovementQuery = z.infer<typeof movementQuerySchema>;

// ── Suppliers & purchases ──

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter the supplier name').max(120),
  contactName: optionalText(80),
  phone: optionalText(40),
  email: optionalText(120),
  address: optionalText(300),
  notes: optionalText(500),
  isActive: z.boolean().default(true),
});
export type SupplierInput = z.input<typeof supplierInputSchema>;

export const purchaseInputSchema = z.object({
  supplierId: z.uuid('Choose a supplier'),
  supplierInvoiceNo: optionalText(60),
  invoiceDate: z.iso.date('Enter the invoice date'),
  /** Discount on the whole invoice; shared over the items when working out their cost. */
  discount: centsSchema.default(0),
  note: optionalText(300),
  items: z
    .array(
      z.object({
        variantId: z.uuid(),
        qty: z.int().min(1, 'Quantity must be at least 1').max(1_000_000),
        unitCost: centsSchema,
      }),
    )
    .min(1, 'Add at least one item')
    .max(500),
});
export type PurchaseInput = z.input<typeof purchaseInputSchema>;

export const supplierPaymentSchema = z.object({
  amount: centsSchema.refine((v) => v > 0, 'Enter the amount'),
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']),
  reference: optionalText(60),
  note: optionalText(300),
  purchaseId: z.uuid().optional(),
});
export type SupplierPaymentInput = z.input<typeof supplierPaymentSchema>;

export const purchaseQuerySchema = pageQuerySchema.extend({
  supplierId: z.uuid().optional(),
  status: z.enum(['DRAFT', 'RECEIVED', 'CANCELLED', 'all']).default('all'),
  q: z.string().trim().max(60).optional(),
});
export type PurchaseQuery = z.infer<typeof purchaseQuerySchema>;

// ── Returns ──

export const REFUND_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'ACCOUNT'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];
export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  ACCOUNT: "Customer's account",
};

export const returnInputSchema = z.object({
  saleId: z.uuid(),
  items: z
    .array(
      z.object({
        saleItemId: z.uuid(),
        qty: z.int().min(1).max(100_000),
        /** false for damaged items that cannot be sold again. */
        restock: z.boolean().default(true),
      }),
    )
    .min(1, 'Choose at least one item to return'),
  reason: z.string().trim().min(3, 'Write why the items are returned').max(300),
  refundMethod: z.enum(REFUND_METHODS),
});
export type ReturnInput = z.input<typeof returnInputSchema>;

export const returnQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type ReturnQuery = z.infer<typeof returnQuerySchema>;

// ── Product import (CSV / Excel) ──

/** One spreadsheet row, as text. The server parses and checks it. */
export const importRowSchema = z.object({
  name: z.string().max(200).optional(),
  variant: z.string().max(80).optional(),
  sku: z.string().max(60).optional(),
  barcode: z.string().max(64).optional(),
  category: z.string().max(60).optional(),
  brand: z.string().max(60).optional(),
  costPrice: z.string().max(30).optional(),
  retailPrice: z.string().max(30).optional(),
  wholesalePrice: z.string().max(30).optional(),
  stock: z.string().max(30).optional(),
  reorderLevel: z.string().max(30).optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const productImportSchema = z.object({
  rows: z
    .array(importRowSchema)
    .min(1, 'The file has no rows')
    .max(5000, 'Import at most 5000 rows at a time'),
  /** false: only check and show what would happen. */
  commit: z.boolean().default(false),
});
export type ProductImportInput = z.input<typeof productImportSchema>;

/** Column names accepted in the import file (lower case). */
export const IMPORT_COLUMNS: Record<keyof ImportRow, string[]> = {
  name: ['name', 'product', 'product name', 'item', 'item name'],
  variant: ['variant', 'variant name', 'colour', 'color', 'model', 'size'],
  sku: ['sku', 'code', 'item code', 'product code'],
  barcode: ['barcode', 'ean', 'upc', 'bar code'],
  category: ['category'],
  brand: ['brand'],
  costPrice: ['cost', 'cost price', 'buying price', 'purchase price'],
  retailPrice: ['retail', 'retail price', 'price', 'selling price', 'sale price'],
  wholesalePrice: ['wholesale', 'wholesale price'],
  stock: ['stock', 'qty', 'quantity', 'opening stock'],
  reorderLevel: ['reorder', 'reorder level', 'min stock', 'minimum stock'],
};
