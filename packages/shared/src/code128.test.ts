import { describe, expect, it } from 'vitest';
import { code128BValues, code128BWidths, code128Svg } from './code128';

describe('Code 128 B', () => {
  it('adds start, checksum and stop symbols', () => {
    // "AB": A=33, B=34 → (104 + 33×1 + 34×2) mod 103 = 205 mod 103 = 102
    expect(code128BValues('AB')).toEqual([104, 33, 34, 102, 106]);
  });

  it('gives 11 modules per symbol and 13 for the stop', () => {
    const text = 'INV-2026-000123';
    const widths = code128BWidths(text);
    const symbols = text.length + 2; // start + data + checksum
    expect(widths.reduce((a, b) => a + b, 0)).toBe(symbols * 11 + 13);
  });

  it('refuses characters it cannot encode', () => {
    expect(() => code128BValues('Rs 1,000 – ok')).toThrow();
  });

  it('draws an SVG', () => {
    expect(code128Svg('INV-1')).toMatch(/^<svg[\s\S]*<rect/);
  });
});
