import { z } from 'zod';
import { PAYMENT_METHODS, PRICE_MODES } from '../enums';
import { centsSchema, pageQuerySchema } from './common';

export const discountSchema = z
  .object({
    type: z.enum(['AMOUNT', 'PERCENT']),
    value: z.int().min(0),
  })
  .refine((d) => d.type !== 'PERCENT' || d.value <= 10_000, 'Discount cannot be more than 100%');

export const checkoutLineSchema = z.object({
  variantId: z.uuid(),
  qty: z.int().min(1, 'Quantity must be at least 1').max(100_000),
  /** The normal retail/wholesale price the till used; the server checks it is still current. */
  listPrice: centsSchema,
  /** The price charged. Different from listPrice means a price override (needs approval). */
  unitPrice: centsSchema,
  discount: discountSchema.nullable().optional(),
  /** Serial number / IMEI of the item (one line per serial). */
  serialNo: z.string().trim().max(60).nullable().optional(),
});

export const checkoutPaymentSchema = z.object({
  /** CREDIT = the customer pays later (needs a customer on the bill). */
  method: z.enum(PAYMENT_METHODS),
  amount: centsSchema.refine((v) => v > 0, 'Payment must be more than zero'),
  reference: z.string().trim().max(60).optional(),
});

export const checkoutSchema = z.object({
  /** Made by the browser for this bill; sending the same bill twice never creates two sales. */
  clientId: z.uuid(),
  priceMode: z.enum(PRICE_MODES),
  customerId: z.uuid().nullable().optional(),
  lines: z.array(checkoutLineSchema).min(1, 'The bill is empty').max(500),
  billDiscount: discountSchema.nullable().optional(),
  payments: z.array(checkoutPaymentSchema).min(1, 'Add a payment').max(10),
  /** Total shown on the till; the server's own calculation must match it. */
  expectedTotal: centsSchema,
  note: z.string().trim().max(300).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CheckoutLineInput = z.infer<typeof checkoutLineSchema>;

export const voidSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Write why the bill is voided').max(300),
});
export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

export const saleQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: z.enum(['COMPLETED', 'VOIDED', 'all']).default('all'),
  cashierId: z.uuid().optional(),
});
export type SaleQuery = z.infer<typeof saleQuerySchema>;

export const printSaleSchema = z.object({
  /** Reprint: the receipt says REPRINT and the audit log records it. */
  copy: z.boolean().default(false),
  openDrawer: z.boolean().default(false),
});
export type PrintSaleInput = z.infer<typeof printSaleSchema>;

/** A parked bill. Lines are re-priced from the catalogue when recalled, except price overrides. */
export const heldCartSchema = z.object({
  priceMode: z.enum(PRICE_MODES),
  customerId: z.uuid().nullable().optional(),
  lines: z
    .array(
      z.object({
        variantId: z.uuid(),
        name: z.string().max(200),
        qty: z.int().min(1).max(100_000),
        listPrice: centsSchema,
        unitPrice: centsSchema,
        discount: discountSchema.nullable().optional(),
        serialNo: z.string().max(60).nullable().optional(),
      }),
    )
    .min(1, 'There is nothing to hold')
    .max(500),
  billDiscount: discountSchema.nullable().optional(),
  note: z.string().max(300).optional(),
});
export type HeldCart = z.infer<typeof heldCartSchema>;

export const holdBillSchema = z.object({
  label: z.string().trim().max(60).optional(),
  cart: heldCartSchema,
});
export type HoldBillInput = z.infer<typeof holdBillSchema>;

export const openCashSessionSchema = z.object({
  openingCash: centsSchema,
});
export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;

/** Print the bill on the screen as a quotation (price offer). Nothing is saved or sold. */
export const quoteSchema = z.object({
  priceMode: z.enum(PRICE_MODES),
  customerId: z.uuid().nullable().optional(),
  lines: z.array(checkoutLineSchema).min(1, 'The bill is empty').max(500),
  billDiscount: discountSchema.nullable().optional(),
  /** The offer is valid for this many days. */
  validDays: z.int().min(1).max(365).default(7),
  print: z.boolean().default(false),
});
export type QuoteInput = z.input<typeof quoteSchema>;
