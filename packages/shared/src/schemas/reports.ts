import { z } from 'zod';
import { pageQuerySchema } from './common';

/** A date range in the shop's time zone, both days included. */
export const reportRangeSchema = z
  .object({
    from: z.iso.date('Choose the start date'),
    to: z.iso.date('Choose the end date'),
  })
  .refine((r) => r.from <= r.to, { message: 'The start date is after the end date', path: ['to'] });
export type ReportRange = z.infer<typeof reportRangeSchema>;

export const REPORT_GROUPS = ['day', 'week', 'month'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const salesReportQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    groupBy: z.enum(REPORT_GROUPS).default('day'),
  })
  .refine((r) => r.from <= r.to, { message: 'The start date is after the end date', path: ['to'] });
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

export const productReportQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    sort: z.enum(['best', 'slow']).default('best'),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
  })
  .refine((r) => r.from <= r.to, { message: 'The start date is after the end date', path: ['to'] });
export type ProductReportQuery = z.infer<typeof productReportQuerySchema>;

export const auditQuerySchema = pageQuerySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  userId: z.uuid().optional(),
  action: z.string().trim().max(60).optional(),
  q: z.string().trim().max(100).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
