import { z } from 'zod';
import { centsSchema, optionalText, pageQuerySchema } from './common';

export const cashMovementSchema = z.object({
  type: z.enum(['CASH_IN', 'CASH_OUT']),
  amount: centsSchema.refine((v) => v > 0, 'Enter the amount'),
  reason: z.string().trim().min(3, 'Write the reason').max(200),
});
export type CashMovementInput = z.infer<typeof cashMovementSchema>;

/** Sri Lankan notes and coins (rupees) for counting the drawer. */
export const LKR_DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

export const closeDaySchema = z.object({
  countedCash: centsSchema,
  /** rupee value → how many, e.g. {"5000": 3}. Optional. */
  denominations: z.record(z.string().regex(/^\d+$/), z.int().min(0).max(100_000)).optional(),
  note: optionalText(500),
});
export type CloseDayInput = z.input<typeof closeDaySchema>;

export const EXPENSE_PAID_FROM = ['DRAWER', 'BANK', 'OTHER'] as const;
export type ExpensePaidFrom = (typeof EXPENSE_PAID_FROM)[number];
export const EXPENSE_PAID_FROM_LABELS: Record<ExpensePaidFrom, string> = {
  DRAWER: 'Cash from the drawer',
  BANK: 'Bank / card',
  OTHER: 'Other (owner paid)',
};
export const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Water',
  'Internet & phone',
  'Salaries',
  'Transport',
  'Repairs',
  'Stationery',
  'Tea & refreshments',
  'Other',
];

export const expenseInputSchema = z.object({
  date: z.iso.date('Enter the date'),
  category: z.string().trim().min(1, 'Choose a category').max(60),
  amount: centsSchema.refine((v) => v > 0, 'Enter the amount'),
  paidFrom: z.enum(EXPENSE_PAID_FROM),
  note: optionalText(300),
});
export type ExpenseInput = z.input<typeof expenseInputSchema>;

export const expenseQuerySchema = pageQuerySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  category: z.string().trim().max(60).optional(),
});
export type ExpenseQuery = z.infer<typeof expenseQuerySchema>;

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Write the reason').max(300),
});
export type CancelInput = z.infer<typeof cancelSchema>;
