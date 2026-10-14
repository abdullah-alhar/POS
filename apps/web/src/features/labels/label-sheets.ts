import { code128Svg, formatMoney } from '@marina/shared';

/** A4 sticker sheets. Sizes in millimetres. */
export interface SheetLayout {
  id: string;
  name: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  top: number;
  left: number;
  gapX: number;
  gapY: number;
}

export const SHEETS: SheetLayout[] = [
  {
    id: '65',
    name: '65 per sheet (38.1 × 21.2 mm)',
    cols: 5,
    rows: 13,
    width: 38.1,
    height: 21.2,
    top: 10.7,
    left: 4.75,
    gapX: 2.5,
    gapY: 0,
  },
  {
    id: '40',
    name: '40 per sheet (48.5 × 25.4 mm)',
    cols: 4,
    rows: 10,
    width: 48.5,
    height: 25.4,
    top: 21.5,
    left: 8,
    gapX: 0,
    gapY: 0,
  },
  {
    id: '24',
    name: '24 per sheet (64 × 33.9 mm)',
    cols: 3,
    rows: 8,
    width: 64,
    height: 33.9,
    top: 12.9,
    left: 7.2,
    gapX: 2.5,
    gapY: 0,
  },
  {
    id: '21',
    name: '21 per sheet (63.5 × 38.1 mm)',
    cols: 3,
    rows: 7,
    width: 63.5,
    height: 38.1,
    top: 15.15,
    left: 7.25,
    gapX: 2.5,
    gapY: 0,
  },
];

export interface LabelItem {
  name: string;
  code: string;
  price: number;
}

export interface LabelOptions {
  sheet: SheetLayout;
  /** Skip this many labels at the start (for a half-used sheet). */
  skip: number;
  showPrice: boolean;
  shopName: string | null;
  currency: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Printable HTML for A4 label sheets. */
export function labelSheetHtml(labels: LabelItem[], o: LabelOptions): string {
  const s = o.sheet;
  const perPage = s.cols * s.rows;
  const cells: (LabelItem | null)[] = [...Array<null>(o.skip).fill(null), ...labels];
  const pages: (LabelItem | null)[][] = [];
  for (let i = 0; i < cells.length; i += perPage) pages.push(cells.slice(i, i + perPage));
  const small = s.height < 25;

  const label = (l: LabelItem | null) => {
    if (!l) return '<div class="label"></div>';
    const barcode = /^[\x20-\x7e]+$/.test(l.code) ? code128Svg(l.code, 40, 1) : '';
    return `<div class="label">
      ${o.shopName ? `<div class="shop">${esc(o.shopName)}</div>` : ''}
      <div class="name">${esc(l.name)}</div>
      ${o.showPrice ? `<div class="price">${esc(formatMoney(l.price, { symbol: o.currency }))}</div>` : ''}
      <div class="bc">${barcode}</div>
      <div class="code">${esc(l.code)}</div>
    </div>`;
  };

  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; }
.page { width: 210mm; height: 297mm; padding: ${s.top}mm 0 0 ${s.left}mm; display: grid;
  grid-template-columns: repeat(${s.cols}, ${s.width}mm); grid-auto-rows: ${s.height}mm;
  column-gap: ${s.gapX}mm; row-gap: ${s.gapY}mm; page-break-after: always; overflow: hidden; }
.label { padding: 1mm 1.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center;
  overflow: hidden; text-align: center; }
.shop { font-size: ${small ? 5 : 6.5}pt; letter-spacing: .02em; text-transform: uppercase; }
.name { font-size: ${small ? 6 : 7.5}pt; line-height: 1.1; max-height: 2.2em; overflow: hidden; }
.price { font-size: ${small ? 8.5 : 11}pt; font-weight: 700; margin-top: .3mm; }
.bc { width: 100%; height: ${small ? 6 : 9}mm; margin-top: .4mm; }
.bc svg { width: 100%; height: 100%; }
.code { font-size: ${small ? 5 : 6}pt; letter-spacing: .05em; }
</style></head><body>${pages.map((p) => `<div class="page">${p.map(label).join('')}</div>`).join('')}</body></html>`;
}
