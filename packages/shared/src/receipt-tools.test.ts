import { describe, expect, it } from 'vitest';
import {
  newReceiptElement,
  RECEIPT_TEMPLATES,
  receiptElementSchema,
  type ReceiptElement,
} from './receipt-layout';
import {
  checkReceipt,
  describeElement,
  diffLayouts,
  estimateBlocks,
  prettyFields,
  savePaper,
  summarizeChanges,
} from './receipt-tools';

const CTX = {
  charsPerLine: 48,
  vatRegistered: false,
  printerMode: 'windows' as const,
  hasPrinterLogo: true,
};
const ids = (issues: { id: string }[]) => issues.map((i) => i.id);

describe('receipt templates', () => {
  it('builds every template as a valid design', () => {
    for (const t of Object.values(RECEIPT_TEMPLATES)) {
      const layout = t.build();
      for (const el of layout) expect(receiptElementSchema.safeParse(el).success).toBe(true);
      expect(checkReceipt(layout, CTX).filter((i) => i.level === 'error')).toEqual([]);
    }
  });

  it('accepts designs saved before layers, conditions and new styles existed', () => {
    const old = { id: 'a', type: 'text', text: 'Hi', align: 'center', bold: false, size: 'large' };
    expect(receiptElementSchema.parse(old)).toEqual(old);
  });
});

describe('checkReceipt', () => {
  it('flags an empty receipt and fixes it with a template', () => {
    const issues = checkReceipt([], CTX);
    expect(ids(issues)).toEqual(['empty']);
    expect(issues[0]!.fix!.apply([]).length).toBeGreaterThan(5);
  });

  it('finds missing items, total, payment and bill number, and the fixes add them', () => {
    let layout: ReceiptElement[] = [{ ...newReceiptElement('text'), text: '{shop_name}' }];
    const issues = checkReceipt(layout, CTX);
    expect(ids(issues)).toEqual(['no-items', 'no-total', 'no-payments', 'no-bill-no']);
    for (const issue of issues) layout = issue.fix!.apply(layout);
    expect(layout.map((e) => e.type)).toEqual(['text', 'pair', 'items', 'totals', 'payments']);
    expect(checkReceipt(layout, CTX).filter((i) => i.level !== 'tip')).toEqual([]);
  });

  it('puts removed items back between the lines around them', () => {
    const classic = RECEIPT_TEMPLATES.classic.build();
    const without = classic.filter((e) => e.type !== 'items');
    const fixed = checkReceipt(without, CTX)
      .find((i) => i.id === 'no-items')!
      .fix!.apply(without);
    const at = fixed.findIndex((e) => e.type === 'items');
    expect(fixed[at - 1]!.type).toBe('divider');
    expect(fixed[at + 1]!.type).toBe('divider');
    expect(ids(checkReceipt(fixed, CTX)).some((id) => id.startsWith('double-line'))).toBe(false);
  });

  it('flags duplicates, empty QR codes, unknown fields, double lines and wide text', () => {
    const layout = RECEIPT_TEMPLATES.classic.build();
    const extraTotal = newReceiptElement('totals');
    const qr = { ...newReceiptElement('qr'), value: ' ' };
    const typo = { ...newReceiptElement('text'), text: 'Bill {bil_no}' };
    const wide = {
      ...newReceiptElement('text'),
      text: 'A very long shop name here',
      size: 'large' as const,
    };
    const line1 = newReceiptElement('divider');
    const line2 = newReceiptElement('divider');
    const issues = checkReceipt([...layout, extraTotal, qr, typo, wide, line1, line2], CTX);
    const found = ids(issues);
    expect(found).toContain('duplicate-totals');
    expect(found).toContain(`qr-empty-${qr.id}`);
    expect(found).toContain(`unknown-field-${typo.id}`);
    expect(found).toContain(`wide-text-${wide.id}`);
    expect(found).toContain(`double-line-${line2.id}`);
    // Errors come first.
    expect(issues[0]!.level).toBe('error');
    const fixed = issues.find((i) => i.id === `wide-text-${wide.id}`)!.fix!.apply([wide]);
    expect(fixed[0]).toMatchObject({ size: 'tall' });
  });

  it('asks VAT-registered shops to print the VAT number', () => {
    const layout = RECEIPT_TEMPLATES.compact.build();
    const issue = checkReceipt(layout, { ...CTX, vatRegistered: true }).find(
      (i) => i.id === 'vat-no',
    )!;
    const fixed = issue.fix!.apply(layout);
    expect(fixed.some((e) => e.type === 'text' && e.text.includes('{vat_no}'))).toBe(true);
    expect(checkReceipt(fixed, { ...CTX, vatRegistered: true }).map((i) => i.id)).not.toContain(
      'vat-no',
    );
  });

  it('ignores hidden pieces but tells about them', () => {
    const layout = RECEIPT_TEMPLATES.classic
      .build()
      .map((e) => (e.type === 'items' ? { ...e, hidden: true } : e));
    const found = ids(checkReceipt(layout, CTX));
    expect(found).toContain('no-items');
    expect(found).toContain('hidden');
  });
});

describe('savePaper', () => {
  it('removes spaces and repeated lines and prints items on one line, but keeps locked pieces', () => {
    const space = newReceiptElement('space');
    const locked = { ...newReceiptElement('space'), locked: true };
    const layout = [
      newReceiptElement('divider'),
      space,
      newReceiptElement('divider'),
      newReceiptElement('items'),
      locked,
    ];
    const out = savePaper(layout);
    expect(out.map((e) => e.type)).toEqual(['divider', 'items', 'space']);
    expect(out[1]).toMatchObject({ layout: 'one-line' });
  });
});

describe('diffLayouts', () => {
  it('lists added, removed, changed and moved pieces', () => {
    const a = newReceiptElement('logo');
    const b = { ...newReceiptElement('text'), text: 'Thank you' };
    const c = newReceiptElement('items');
    const d = newReceiptElement('totals');
    const e = newReceiptElement('barcode');
    const before = [a, b, c, d];
    const after = [b, c, { ...d, bigTotal: false }, a, e];
    const changes = diffLayouts(before, after);
    expect(changes).toContainEqual({ kind: 'added', id: e.id, label: 'Bill barcode' });
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: 'changed', id: d.id, details: ['big total: on → off'] }),
    );
    // Only the logo moved; the others kept their order.
    expect(changes.filter((x) => x.kind === 'moved').map((x) => x.id)).toEqual([a.id]);
    expect(summarizeChanges(changes)).toBe('1 added · 1 changed · 1 moved');
    expect(diffLayouts(before, before)).toEqual([]);
  });

  it('treats a missing switch like an off switch', () => {
    const t = { ...newReceiptElement('text'), text: 'x' };
    expect(diffLayouts([t], [{ ...t, underline: false }])).toEqual([]);
  });
});

describe('names and estimates', () => {
  it('shows fields as words', () => {
    expect(prettyFields('Bill: {bill_no} {nope}')).toBe('Bill: [Bill number] {nope}');
    expect(describeElement({ ...newReceiptElement('text'), text: 'Tel: {shop_phone}' })).toBe(
      'Tel: [Shop phone]',
    );
    expect(describeElement({ ...newReceiptElement('text'), name: 'Footer' })).toBe('Footer');
  });

  it('estimates the paper length', () => {
    const short = estimateBlocks([{ type: 'text', text: 'Hi' }], 48);
    const long = estimateBlocks(
      [
        { type: 'logo' },
        { type: 'text', text: 'x'.repeat(100), large: true },
        { type: 'qr', value: 'x', size: 'large' },
      ],
      48,
    );
    expect(short.lines).toBe(1);
    expect(long.mm).toBeGreaterThan(short.mm + 50);
  });
});
