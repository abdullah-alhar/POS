import { describe, expect, it } from 'vitest';
import { ean13CheckDigit, isValidEan13, makeInternalEan13 } from './barcode';

describe('EAN-13', () => {
  it('computes check digits for real barcodes', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });
  it('makes in-store barcodes starting with 2', () => {
    const code = makeInternalEan13(42);
    expect(code).toHaveLength(13);
    expect(code.startsWith('200000000042')).toBe(true);
    expect(isValidEan13(code)).toBe(true);
  });
  it('rejects out-of-range sequences', () => {
    expect(() => makeInternalEan13(0)).toThrow();
    expect(() => makeInternalEan13(100_000_000_000)).toThrow();
  });
});
