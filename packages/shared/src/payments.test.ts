import { describe, expect, it } from 'vitest';
import { quickCashAmounts, summarizePayments } from './payments';

describe('summarizePayments', () => {
  it('works out change for cash', () => {
    const s = summarizePayments(810_000, [{ method: 'CASH', amount: 1_000_000 }]);
    expect(s).toMatchObject({
      paid: 810_000,
      remaining: 0,
      change: 190_000,
      complete: true,
      error: null,
    });
    expect(s.applied).toEqual([810_000]);
  });

  it('accepts an exact card payment', () => {
    const s = summarizePayments(450_000, [{ method: 'CARD', amount: 450_000 }]);
    expect(s).toMatchObject({ change: 0, complete: true });
  });

  it('splits between card and cash, with change only from cash', () => {
    const s = summarizePayments(1_000_000, [
      { method: 'CASH', amount: 500_000 },
      { method: 'CARD', amount: 600_000 },
    ]);
    expect(s.applied).toEqual([400_000, 600_000]);
    expect(s.change).toBe(100_000);
    expect(s.complete).toBe(true);
  });

  it('shows what is still due', () => {
    const s = summarizePayments(1_000_000, [{ method: 'BANK_TRANSFER', amount: 300_000 }]);
    expect(s).toMatchObject({ remaining: 700_000, complete: false, error: null });
  });

  it('refuses card payments larger than the bill', () => {
    const s = summarizePayments(100_000, [{ method: 'CARD', amount: 150_000 }]);
    expect(s.complete).toBe(false);
    expect(s.error).toMatch(/cannot be more than the bill/);
    expect(s.change).toBe(0);
  });

  it('refuses zero or negative payments', () => {
    expect(summarizePayments(100, [{ method: 'CASH', amount: 0 }]).error).toBeTruthy();
    expect(summarizePayments(100, [{ method: 'CASH', amount: -5 }]).complete).toBe(false);
  });

  it('handles a free (zero total) bill', () => {
    const s = summarizePayments(0, [{ method: 'CASH', amount: 100 }]);
    expect(s).toMatchObject({ remaining: 0, change: 100, complete: true });
  });
});

describe('quickCashAmounts', () => {
  it('offers the exact amount and round notes above it', () => {
    expect(quickCashAmounts(810_000)).toEqual([810_000, 850_000, 900_000, 1_000_000]);
    expect(quickCashAmounts(100_000)).toEqual([100_000, 500_000]);
    expect(quickCashAmounts(0)).toEqual([]);
  });
});
