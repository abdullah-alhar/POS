import { describe, expect, it } from 'vitest';
import {
  calculateCart,
  CartCalcError,
  discountPercentBp,
  taxIncluded,
  type CartLineInput,
} from './cart-calc';

const RUPEE = { pricesIncludeTax: true, roundingStep: 100 };
const EXACT = { pricesIncludeTax: true, roundingStep: 1 };

const line = (
  key: string,
  unitPrice: number,
  qty = 1,
  extra: Partial<CartLineInput> = {},
): CartLineInput => ({
  key,
  unitPrice,
  qty,
  taxRateBp: 0,
  ...extra,
});

describe('calculateCart', () => {
  it('returns zeros for an empty cart', () => {
    const t = calculateCart([], null, RUPEE);
    expect(t.total).toBe(0);
    expect(t.lines).toEqual([]);
    expect(t.itemCount).toBe(0);
  });

  it('adds up simple lines', () => {
    const t = calculateCart([line('a', 150_000, 2), line('b', 45_000)], null, RUPEE);
    expect(t.subtotal).toBe(345_000);
    expect(t.total).toBe(345_000);
    expect(t.itemCount).toBe(3);
    expect(t.roundingAdjustment).toBe(0);
  });

  it('applies an amount discount to one line', () => {
    const t = calculateCart(
      [line('a', 150_000, 2, { discount: { type: 'AMOUNT', value: 20_000 } })],
      null,
      RUPEE,
    );
    expect(t.lines[0]!.discountAmount).toBe(20_000);
    expect(t.total).toBe(280_000);
  });

  it('rounds percentage discounts to whole rupees', () => {
    // 12.5% of Rs 1,255 = Rs 156.875 → Rs 157
    const t = calculateCart(
      [line('a', 125_500, 1, { discount: { type: 'PERCENT', value: 1250 } })],
      null,
      RUPEE,
    );
    expect(t.lines[0]!.discountAmount).toBe(15_700);
    expect(t.total).toBe(109_800);
  });

  it('never lets a discount exceed the line', () => {
    const t = calculateCart(
      [line('a', 10_000, 1, { discount: { type: 'AMOUNT', value: 50_000 } })],
      null,
      RUPEE,
    );
    expect(t.lines[0]!.discountAmount).toBe(10_000);
    expect(t.total).toBe(0);
  });

  it('rejects a discount above 100%', () => {
    expect(() =>
      calculateCart(
        [line('a', 100, 1, { discount: { type: 'PERCENT', value: 10_001 } })],
        null,
        RUPEE,
      ),
    ).toThrow(CartCalcError);
  });

  it('spreads a bill discount across lines and keeps the sum exact', () => {
    const t = calculateCart(
      [line('a', 100_000), line('b', 100_000), line('c', 100_000)],
      { type: 'AMOUNT', value: 10_000 },
      EXACT,
    );
    expect(t.billDiscountAmount).toBe(10_000);
    expect(t.lines.map((l) => l.billDiscountShare)).toEqual([3334, 3333, 3333]);
    expect(t.lines.reduce((s, l) => s + l.net, 0)).toBe(290_000);
    expect(t.total).toBe(290_000);
  });

  it('applies the bill discount after item discounts', () => {
    const t = calculateCart(
      [line('a', 200_000, 1, { discount: { type: 'AMOUNT', value: 20_000 } }), line('b', 20_000)],
      { type: 'PERCENT', value: 1000 },
      RUPEE,
    );
    // base 180,000 + 20,000 = 200,000 → 10% = 20,000
    expect(t.billDiscountAmount).toBe(20_000);
    expect(t.lines.map((l) => l.billDiscountShare)).toEqual([18_000, 2_000]);
    expect(t.discountTotal).toBe(40_000);
    expect(t.total).toBe(180_000);
  });

  it('rounds the bill total to whole rupees and reports the adjustment', () => {
    // Price with cents: Rs 99.75 × 3 = Rs 299.25 → Rs 299
    const t = calculateCart([line('a', 9975, 3)], null, RUPEE);
    expect(t.totalBeforeRounding).toBe(29_925);
    expect(t.total).toBe(29_900);
    expect(t.roundingAdjustment).toBe(-25);
  });

  it('rounds .50 up', () => {
    const t = calculateCart([line('a', 1050)], null, RUPEE);
    expect(t.total).toBe(1100);
    expect(t.roundingAdjustment).toBe(50);
  });

  it('extracts tax from tax-inclusive prices without changing the total', () => {
    const t = calculateCart([line('a', 118_000, 1, { taxRateBp: 1800 })], null, RUPEE);
    expect(t.lines[0]!.taxAmount).toBe(18_000);
    expect(t.taxTotal).toBe(18_000);
    expect(t.total).toBe(118_000);
  });

  it('adds tax on top when prices exclude tax', () => {
    const t = calculateCart([line('a', 100_000, 1, { taxRateBp: 1800 })], null, {
      pricesIncludeTax: false,
      roundingStep: 100,
    });
    expect(t.lines[0]!.taxAmount).toBe(18_000);
    expect(t.lines[0]!.lineTotal).toBe(118_000);
    expect(t.total).toBe(118_000);
  });

  it('works out tax on the discounted amount', () => {
    const t = calculateCart(
      [line('a', 118_000, 1, { taxRateBp: 1800, discount: { type: 'AMOUNT', value: 11_800 } })],
      null,
      EXACT,
    );
    expect(t.lines[0]!.net).toBe(106_200);
    expect(t.lines[0]!.taxAmount).toBe(16_200);
  });

  it('rejects bad quantities and prices', () => {
    expect(() => calculateCart([line('a', 100, 0)], null, RUPEE)).toThrow(CartCalcError);
    expect(() => calculateCart([line('a', 100, 1.5)], null, RUPEE)).toThrow(CartCalcError);
    expect(() => calculateCart([line('a', -1)], null, RUPEE)).toThrow(CartCalcError);
    expect(() => calculateCart([line('a', 10.5)], null, RUPEE)).toThrow(CartCalcError);
  });

  it('gives the same result for the same input (client and server agree)', () => {
    const lines = [
      line('a', 123_456, 3, { discount: { type: 'PERCENT', value: 725 }, taxRateBp: 1800 }),
      line('b', 9_999, 7, { taxRateBp: 0 }),
      line('c', 45_000, 1, { discount: { type: 'AMOUNT', value: 1_000 } }),
    ];
    const a = calculateCart(lines, { type: 'PERCENT', value: 333 }, RUPEE);
    const b = calculateCart(structuredClone(lines), { type: 'PERCENT', value: 333 }, RUPEE);
    expect(a).toEqual(b);
    expect(a.lines.reduce((s, l) => s + l.lineTotal, 0) + a.roundingAdjustment).toBe(a.total);
  });
});

describe('helpers', () => {
  it('taxIncluded', () => {
    expect(taxIncluded(11_500, 1500)).toBe(1500);
    expect(taxIncluded(10_000, 0)).toBe(0);
  });
  it('discountPercentBp', () => {
    expect(discountPercentBp(15_000, 100_000)).toBe(1500);
    expect(discountPercentBp(1, 0)).toBe(0);
  });
});
