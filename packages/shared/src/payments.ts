import type { PaymentMethod } from './enums';
import type { Cents } from './money';

/**
 * Payments for one bill. For cash, `amount` is what the customer handed over (it may be more than
 * the bill: the difference is change). Card, bank transfer and credit must not exceed what is due.
 */
export interface PaymentEntry {
  method: PaymentMethod;
  amount: Cents;
  reference?: string;
}

export interface PaymentSummary {
  /** Card + bank transfer + credit. */
  nonCash: Cents;
  /** All cash handed over. */
  cashTendered: Cents;
  /** Amount applied to the bill (never more than the total). */
  paid: Cents;
  /** Still to pay. */
  remaining: Cents;
  /** Cash to give back. */
  change: Cents;
  /** Amount applied to the bill for each entry (same order); cash entries are applied after the others. */
  applied: Cents[];
  /** The bill is fully paid and the payments make sense. */
  complete: boolean;
  /** Why the payments are not acceptable, if they are not. */
  error: string | null;
}

export function summarizePayments(total: Cents, entries: readonly PaymentEntry[]): PaymentSummary {
  let error: string | null = null;
  if (entries.some((e) => !Number.isSafeInteger(e.amount) || e.amount <= 0)) {
    error = 'Every payment must be more than zero';
  }

  const nonCash = entries.filter((e) => e.method !== 'CASH').reduce((s, e) => s + e.amount, 0);
  const cashTendered = entries.filter((e) => e.method === 'CASH').reduce((s, e) => s + e.amount, 0);
  if (!error && nonCash > total) {
    error = 'Card, bank and credit payments cannot be more than the bill';
  }

  // Non-cash first (exact amounts), then cash covers the rest.
  const applied: Cents[] = [];
  let left = total;
  for (const e of entries) {
    if (e.method === 'CASH') {
      applied.push(0);
      continue;
    }
    const a = Math.min(e.amount, Math.max(left, 0));
    applied.push(a);
    left -= a;
  }
  entries.forEach((e, i) => {
    if (e.method !== 'CASH') return;
    const a = Math.min(e.amount, Math.max(left, 0));
    applied[i] = a;
    left -= a;
  });

  const paid = Math.min(total, nonCash + cashTendered);
  const remaining = Math.max(0, total - nonCash - cashTendered);
  const change = Math.max(0, nonCash + cashTendered - total);

  return {
    nonCash,
    cashTendered,
    paid,
    remaining,
    change: error ? 0 : change,
    applied,
    complete: !error && remaining === 0,
    error,
  };
}

/** Sensible "customer gave" amounts: the exact total and the next round notes above it. */
export function quickCashAmounts(due: Cents, max = 4): Cents[] {
  if (due <= 0) return [];
  const options = new Set<Cents>([due]);
  for (const step of [10_000, 50_000, 100_000, 500_000]) {
    const rounded = Math.ceil(due / step) * step;
    if (rounded > due) options.add(rounded);
  }
  return [...options].sort((a, b) => a - b).slice(0, max);
}
