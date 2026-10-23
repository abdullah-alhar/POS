import { describe, expect, it } from 'vitest';
import type { ReceiptDoc } from '@shoppos/shared';
import { drawerKick, encodeReceipt, renderText, toPrintable, wrap } from './escpos';

const doc: ReceiptDoc = {
  blocks: [
    { type: 'logo' },
    { type: 'text', text: 'My Shop', align: 'center', bold: true },
    { type: 'divider' },
    { type: 'text', text: 'Anker 20W Charger – White' },
    { type: 'row', left: '  2 x 4,500', right: '9,000' },
    { type: 'row', left: 'TOTAL', right: 'Rs 9,000', bold: true, large: true },
    { type: 'barcode', value: 'INV-2026-000001' },
  ],
};

const options = { charsPerLine: 48, logo: null, autoCut: true, feedLines: 3, openDrawer: false };

describe('ESC/POS encoder', () => {
  it('starts with initialise and ends with feed + cut', () => {
    const bytes = encodeReceipt(doc, options);
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.subarray(-4)]).toEqual([0x1d, 0x56, 66, 0]);
  });

  it('kicks the drawer only when asked', () => {
    const kick = drawerKick();
    expect(encodeReceipt(doc, options).includes(kick)).toBe(false);
    expect(encodeReceipt(doc, { ...options, openDrawer: true }).includes(kick)).toBe(true);
  });

  it('prints a Code 128 barcode of the bill number', () => {
    const bytes = encodeReceipt(doc, options);
    const data = '{BINV-2026-000001';
    expect(bytes.includes(Buffer.from([0x1d, 0x6b, 73, data.length, ...Buffer.from(data)]))).toBe(
      true,
    );
  });

  it('lines up rows to the full paper width', () => {
    const text = renderText(doc, 48).split('\n');
    expect(text).toContain(`  2 x 4,500${' '.repeat(48 - 11 - 5)}9,000`);
    // Large text is double width, so the row uses half the characters.
    expect(text.find((l) => l.startsWith('TOTAL'))).toHaveLength(24);
  });

  it('includes the logo as raster image when one is set', () => {
    const logo = {
      width: 16,
      height: 2,
      data: Buffer.from([0xff, 0x00, 0x0f, 0xf0]).toString('base64'),
    };
    const bytes = encodeReceipt(doc, { ...options, logo });
    expect(
      bytes.includes(Buffer.from([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0])),
    ).toBe(true);
  });

  it('makes text safe for the printer', () => {
    expect(toPrintable('Café – “ok” × 2')).toBe('Cafe - "ok" x 2');
    expect(toPrintable('සිංහල')).toMatch(/^\?+$/);
  });

  it('wraps long text on word boundaries', () => {
    expect(wrap('Baseus 65W GaN 3-Port Charger for laptops and phones', 20)).toEqual([
      'Baseus 65W GaN',
      '3-Port Charger for',
      'laptops and phones',
    ]);
  });

  it('prints tall, wide, underlined and white-on-black text', () => {
    const styled: ReceiptDoc = {
      blocks: [
        { type: 'text', text: 'TALL', tall: true },
        { type: 'text', text: 'WIDE', wide: true, underline: true },
        { type: 'text', text: 'THANK YOU', invert: true },
      ],
    };
    const bytes = encodeReceipt(styled, options);
    const line = (size: number, underline: number, invert: number, text: string) =>
      Buffer.from([
        0x1b,
        0x45,
        0,
        0x1d,
        0x21,
        size,
        0x1b,
        0x2d,
        underline,
        0x1d,
        0x42,
        invert,
        ...Buffer.from(text),
      ]);
    expect(bytes.includes(line(0x01, 0, 0, 'TALL'))).toBe(true);
    expect(bytes.includes(line(0x10, 1, 0, 'WIDE'))).toBe(true);
    expect(bytes.includes(line(0x00, 0, 1, 'THANK YOU'))).toBe(true);
    // Wide letters take two places, so wrapping uses half the paper width.
    expect(renderText({ blocks: [{ type: 'text', text: 'x'.repeat(30), wide: true }] }, 48)).toBe(
      `${'X'.repeat(24)}\n${'X'.repeat(6)}`,
    );
  });

  it('prints QR codes in three sizes and dotted lines', () => {
    const qr = (size: 'small' | 'large') =>
      encodeReceipt({ blocks: [{ type: 'qr', value: 'x', size }] }, options).includes(
        Buffer.from([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, size === 'small' ? 4 : 8]),
      );
    expect(qr('small')).toBe(true);
    expect(qr('large')).toBe(true);
    expect(renderText({ blocks: [{ type: 'divider', char: '.' }] }, 32)).toBe('.'.repeat(32));
  });
});
