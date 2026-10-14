import { z } from 'zod';
import { CUSTOMER_TYPES } from '../enums';
import { centsSchema, optionalText, pageQuerySchema, queryBool } from './common';

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter the name').max(120),
  phone: optionalText(40),
  email: optionalText(120),
  address: optionalText(300),
  type: z.enum(CUSTOMER_TYPES).default('RETAIL'),
  /** Most the customer may owe. 0 = no credit sales. */
  creditLimit: centsSchema.default(0),
  notes: optionalText(500),
  isActive: z.boolean().default(true),
});
export type CustomerInput = z.input<typeof customerInputSchema>;

export const customerQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(60).optional(),
  type: z.enum(['RETAIL', 'WHOLESALE']).optional(),
  owing: queryBool.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

export const customerPaymentSchema = z.object({
  amount: centsSchema.refine((v) => v > 0, 'Enter the amount'),
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']),
  reference: optionalText(60),
  note: optionalText(300),
});
export type CustomerPaymentInput = z.input<typeof customerPaymentSchema>;

/** Admin correction of what a customer owes (e.g. an old balance from before the POS). */
export const customerAdjustSchema = z.object({
  /** Positive: the customer owes more. Negative: owes less. */
  amount: z
    .int()
    .refine((v) => v !== 0, 'Enter an amount')
    .refine((v) => Math.abs(v) <= 2_000_000_000, 'Too large'),
  note: z.string().trim().min(3, 'Write why').max(300),
});
export type CustomerAdjustInput = z.infer<typeof customerAdjustSchema>;

export const LEDGER_TYPE_LABELS: Record<string, string> = {
  CREDIT_SALE: 'Credit sale',
  PAYMENT: 'Payment',
  RETURN: 'Return',
  ADJUSTMENT: 'Adjustment',
};
