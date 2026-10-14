import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  bpToPercentText,
  centsToInput,
  divRound,
  formatMoney,
  parseMoney,
  parsePercent,
  percentOf,
  roundToStep,
} from './money';

describe('divRound', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(-4, 3)).toBe(-1);
    expect(divRound(0, 7)).toBe(0);
  });
  it('rejects division by zero and non-integers', () => {
    expect(() => divRound(1, 0)).toThrow();
    expect(() => divRound(1.5, 2)).toThrow();
  });
});

describe('percentOf', () => {
  it('computes percentages in basis points', () => {
    expect(percentOf(125_000, 1000)).toBe(12_500); // 10% of Rs 1,250
    expect(percentOf(999, 1250)).toBe(125); // 12.5% of 9.99 = 1.24875 → 1.25
    expect(percentOf(100, 3333)).toBe(33);
  });
});

describe('roundToStep', () => {
  it('rounds to whole rupees', () => {
    expect(roundToStep(112_950, 100)).toBe(113_000);
    expect(roundToStep(112_949, 100)).toBe(112_900);
    expect(roundToStep(-150, 100)).toBe(-200);
  });
  it('leaves amounts alone with step 1', () => {
    expect(roundToStep(12_345, 1)).toBe(12_345);
  });
});

describe('allocateProportionally', () => {
  it('always adds up to the total', () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((a, b) => a + b)).toBe(100);
  });
  it('splits in proportion to weights', () => {
    expect(allocateProportionally(1000, [3000, 1000])).toEqual([750, 250]);
  });
  it('handles zero weights and totals', () => {
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(10, [0, 0])).toEqual([0, 0]);
    expect(allocateProportionally(10, [])).toEqual([]);
  });
  it('stays exact for very large numbers', () => {
    const parts = allocateProportionally(2_000_000_000, [2_000_000_000, 1, 1]);
    expect(parts.reduce((a, b) => a + b)).toBe(2_000_000_000);
  });
  it('rejects negative input', () => {
    expect(() => allocateProportionally(-1, [1])).toThrow();
  });
});

describe('parsing', () => {
  it('parses money without floating point', () => {
    expect(parseMoney('1,250.50')).toBe(125_050);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('.5')).toBe(50);
    expect(parseMoney('19.99')).toBe(1999);
    expect(parseMoney('100')).toBe(10_000);
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });
  it('parses percentages into basis points', () => {
    expect(parsePercent('12.5')).toBe(1250);
    expect(parsePercent('10')).toBe(1000);
    expect(bpToPercentText(1250)).toBe('12.5');
    expect(bpToPercentText(1000)).toBe('10');
    expect(bpToPercentText(1205)).toBe('12.05');
  });
  it('formats cents for input fields', () => {
    expect(centsToInput(125_050)).toBe('1250.50');
    expect(centsToInput(125_000)).toBe('1250');
    expect(centsToInput(-5)).toBe('-0.05');
  });
});

describe('formatMoney', () => {
  it('shows whole rupees by default', () => {
    expect(formatMoney(125_000)).toBe('Rs 1,250');
    expect(formatMoney(112_950)).toBe('Rs 1,130');
    expect(formatMoney(0)).toBe('Rs 0');
    expect(formatMoney(-40)).toBe('Rs 0');
    expect(formatMoney(-150_000)).toBe('-Rs 1,500');
  });
  it('can show cents and other symbols', () => {
    expect(formatMoney(125_050, { showCents: true })).toBe('Rs 1,250.50');
    expect(formatMoney(123_456_789, { symbol: '' })).toBe('1,234,568');
  });
});
