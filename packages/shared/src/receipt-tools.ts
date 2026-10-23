import type { ReceiptBlock } from './receipt';
import {
  DIVIDER_STYLES,
  newReceiptElement,
  RECEIPT_CONDITIONS,
  RECEIPT_ELEMENT_INFO,
  RECEIPT_FIELDS,
  RECEIPT_SINGLE_PIECES,
  RECEIPT_TEMPLATES,
  TEXT_SIZES,
  type ReceiptElement,
  type ReceiptElementType,
  type ReceiptField,
} from './receipt-layout';

/**
 * Helpers for the receipt editor that do not need the server: names for pieces, a design check
 * with one-click fixes, a paper-length estimate and a comparison of two designs.
 */

/** "{shop_name}" → "[Shop name]", so people see words instead of codes. */
export function prettyFields(text: string): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in RECEIPT_FIELDS ? `[${RECEIPT_FIELDS[k as ReceiptField]}]` : m,
  );
}

/** Fields used in a text that the receipt does not know (printed as typed). */
export function unknownFields(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((k) => !(k in RECEIPT_FIELDS));
}

/** A short readable name for a piece, e.g. 'Text "Thank you!"' (for layers, history, checks). */
export function describeElement(el: ReceiptElement): string {
  if (el.name) return el.name;
  const label = RECEIPT_ELEMENT_INFO[el.type].label;
  const short = (s: string, n = 28) => {
    const one = prettyFields(s).replace(/\s+/g, ' ').trim();
    return one.length > n ? `${one.slice(0, n - 1)}…` : one;
  };
  switch (el.type) {
    case 'text':
      return el.text.trim() ? short(el.text) : 'Empty text';
    case 'pair':
      return short(`${el.left} | ${el.right}`);
    case 'divider':
      return `Line ${DIVIDER_STYLES[el.style].slice(0, 5)}`;
    case 'space':
      return el.lines === 1 ? 'Space' : `Space × ${el.lines}`;
    case 'items':
      return el.layout === 'one-line' ? 'Items (one line)' : 'Items';
    case 'qr':
      return el.value ? `QR ${short(el.value, 22)}` : 'QR (empty)';
    case 'signature':
      return `Signature: ${short(el.label, 20)}`;
    default:
      return label;
  }
}

/** Which element types a piece list holds (only visible pieces). */
const visible = (layout: readonly ReceiptElement[]) => layout.filter((e) => !e.hidden);

function usesField(layout: readonly ReceiptElement[], field: ReceiptField) {
  const tag = `{${field}}`;
  return visible(layout).some(
    (e) =>
      (e.type === 'text' && e.text.includes(tag)) ||
      (e.type === 'pair' && (e.left.includes(tag) || e.right.includes(tag))),
  );
}

function insertAt(layout: readonly ReceiptElement[], at: number, ...els: ReceiptElement[]) {
  const pos = Math.max(0, Math.min(layout.length, at));
  return [...layout.slice(0, pos), ...els, ...layout.slice(pos)];
}

/** Where shop details end: just before the first line or the items. */
function afterHeader(layout: readonly ReceiptElement[]) {
  const i = layout.findIndex((e) => e.type === 'divider' || e.type === 'items');
  return i < 0 ? 0 : i;
}

/** Where the items go back: above the total, between the lines around them if there are two. */
export function itemsSpot(layout: readonly ReceiptElement[]) {
  const t = layout.findIndex((e) => e.type === 'totals' && !e.hidden);
  if (t < 0) return afterHeader(layout) + 1;
  return layout[t - 1]?.type === 'divider' && layout[t - 2]?.type === 'divider' ? t - 1 : t;
}

/** Where bill details go: under the first line, or above the items when there is no line. */
function billDetailsSpot(layout: readonly ReceiptElement[]) {
  const i = afterHeader(layout);
  return layout[i]?.type === 'divider' ? i + 1 : i;
}

const indexOfType = (layout: readonly ReceiptElement[], type: ReceiptElementType) =>
  layout.findIndex((e) => e.type === type && !e.hidden);

/**
 * Make a receipt use less paper: no empty lines, one line per item, no two lines in a row.
 * Pieces the shop locked are kept as they are.
 */
export function savePaper(layout: readonly ReceiptElement[]): ReceiptElement[] {
  const out: ReceiptElement[] = [];
  for (const el of layout) {
    if (el.locked) {
      out.push(el);
      continue;
    }
    if (el.type === 'space') continue;
    if (el.type === 'items' && el.layout !== 'one-line') {
      out.push({ ...el, layout: 'one-line' });
      continue;
    }
    const prev = out.filter((e) => !e.hidden).at(-1);
    if (el.type === 'divider' && !el.hidden && prev?.type === 'divider') continue;
    out.push(el);
  }
  return out;
}

export type ReceiptIssueLevel = 'error' | 'warning' | 'tip';

export interface ReceiptIssue {
  id: string;
  level: ReceiptIssueLevel;
  title: string;
  detail?: string;
  /** The piece the issue is about (the editor can select it). */
  elementId?: string;
  /** A one-click fix: returns the corrected design. */
  fix?: { label: string; apply: (layout: ReceiptElement[]) => ReceiptElement[] };
}

export interface ReceiptCheckContext {
  charsPerLine: number;
  vatRegistered: boolean;
  /** Printer mode; the thermal printer needs the logo prepared in Printer settings. */
  printerMode: 'browser' | 'windows' | 'network' | 'file';
  hasPrinterLogo: boolean;
  /** Estimated paper length in mm, from the live preview (optional). */
  estimateMm?: number;
}

/**
 * Check a receipt design for mistakes, like a print preflight: missing totals, bill numbers
 * returns need, empty QR codes, text too long for big letters, and paper wasters.
 * Errors make a bad receipt, warnings are likely mistakes, tips are nice to have.
 */
export function checkReceipt(
  layout: readonly ReceiptElement[],
  ctx: ReceiptCheckContext,
): ReceiptIssue[] {
  const issues: ReceiptIssue[] = [];
  const shown = visible(layout);

  if (!layout.length) {
    issues.push({
      id: 'empty',
      level: 'error',
      title: 'The receipt is empty',
      detail: 'Nothing would be printed.',
      fix: { label: 'Use the Classic design', apply: () => RECEIPT_TEMPLATES.classic.build() },
    });
    return issues;
  }
  if (layout.length && !shown.length) {
    issues.push({
      id: 'all-hidden',
      level: 'error',
      title: 'Every piece is hidden',
      detail: 'Hidden pieces are not printed.',
      fix: {
        label: 'Show all pieces',
        apply: (l) => l.map((e) => (e.hidden ? { ...e, hidden: false } : e)),
      },
    });
  }

  if (indexOfType(layout, 'items') < 0) {
    issues.push({
      id: 'no-items',
      level: 'error',
      title: 'The items are missing',
      detail: 'Customers cannot see what they bought.',
      fix: {
        label: 'Add the items',
        apply: (l) => insertAt(l, itemsSpot(l), newReceiptElement('items')),
      },
    });
  }
  if (indexOfType(layout, 'totals') < 0) {
    issues.push({
      id: 'no-total',
      level: 'error',
      title: 'The total is missing',
      fix: {
        label: 'Add the total under the items',
        apply: (l) => {
          const i = indexOfType(l, 'items');
          return insertAt(l, i >= 0 ? i + 1 : l.length, newReceiptElement('totals'));
        },
      },
    });
  }
  if (indexOfType(layout, 'payments') < 0) {
    issues.push({
      id: 'no-payments',
      level: 'warning',
      title: 'Payment and change are not shown',
      detail: 'Customers like to see what they paid and their change.',
      fix: {
        label: 'Add payment under the total',
        apply: (l) => {
          const i = indexOfType(l, 'totals');
          return insertAt(l, i >= 0 ? i + 1 : l.length, newReceiptElement('payments'));
        },
      },
    });
  }
  if (!usesField(layout, 'bill_no') && indexOfType(layout, 'barcode') < 0) {
    issues.push({
      id: 'no-bill-no',
      level: 'warning',
      title: 'No bill number on the receipt',
      detail: 'Returns and reprints need the bill number or the bill barcode.',
      fix: {
        label: 'Add "Bill / date" under the shop details',
        apply: (l) => insertAt(l, billDetailsSpot(l), newReceiptElement('pair')),
      },
    });
  }

  for (const type of RECEIPT_SINGLE_PIECES) {
    const same = shown.filter((e) => e.type === type);
    if (same.length > 1) {
      const extra = same.slice(1).map((e) => e.id);
      issues.push({
        id: `duplicate-${type}`,
        level: 'warning',
        title: `${RECEIPT_ELEMENT_INFO[type].label} is on the receipt ${same.length} times`,
        elementId: extra[0],
        fix: {
          label: 'Remove the extra copies',
          apply: (l) => l.filter((e) => !extra.includes(e.id)),
        },
      });
    }
  }

  if (ctx.vatRegistered && !usesField(layout, 'vat_no')) {
    issues.push({
      id: 'vat-no',
      level: 'warning',
      title: 'The VAT number is not printed',
      detail: 'VAT-registered shops should show their VAT number on bills.',
      fix: {
        label: 'Add "VAT No" under the shop details',
        apply: (l) =>
          insertAt(l, afterHeader(l), {
            ...newReceiptElement('text'),
            text: 'VAT No: {vat_no}',
          }),
      },
    });
  }

  if (ctx.printerMode !== 'browser' && !ctx.hasPrinterLogo && indexOfType(layout, 'logo') >= 0) {
    issues.push({
      id: 'printer-logo',
      level: 'tip',
      title: 'The receipt printer has no logo yet',
      detail: 'Open Settings → Printer and press Save once; the logo is then prepared for it.',
      elementId: layout.find((e) => e.type === 'logo')?.id,
    });
  }

  let prev: ReceiptElement | undefined;
  for (const el of layout) {
    if (el.type === 'qr' && !el.hidden) {
      if (!el.value.trim()) {
        issues.push({
          id: `qr-empty-${el.id}`,
          level: 'error',
          title: 'A QR code has no link or text',
          detail: 'It is left out when printing.',
          elementId: el.id,
          fix: { label: 'Remove it', apply: (l) => l.filter((e) => e.id !== el.id) },
        });
      } else if (el.value.length > 150) {
        issues.push({
          id: `qr-long-${el.id}`,
          level: 'warning',
          title: 'A QR code holds a lot of text',
          detail: 'Long QR codes print small and are hard to scan. Use a short link.',
          elementId: el.id,
        });
      }
    }
    if (el.type === 'text' || el.type === 'pair') {
      const text = el.type === 'text' ? el.text : `${el.left}${el.right}`;
      const unknown = unknownFields(text);
      if (unknown.length) {
        issues.push({
          id: `unknown-field-${el.id}`,
          level: 'warning',
          title: `Unknown field {${unknown[0]}}`,
          detail: 'It is printed exactly as typed. Use the field buttons to insert bill details.',
          elementId: el.id,
        });
      }
    }
    if (el.type === 'text' && !el.hidden && (el.size === 'large' || el.size === 'wide')) {
      const longest = Math.max(
        ...el.text.split('\n').map((t) => t.replace(/\{\w+\}/g, 'xxxxxxxx').length),
      );
      if (longest > Math.floor(ctx.charsPerLine / 2)) {
        issues.push({
          id: `wide-text-${el.id}`,
          level: 'tip',
          title: `"${describeElement(el)}" will wrap onto two lines`,
          detail: `${TEXT_SIZES[el.size]} letters fit ${Math.floor(ctx.charsPerLine / 2)} to a line.`,
          elementId: el.id,
          fix: {
            label: 'Use tall letters instead',
            apply: (l) => l.map((e) => (e.id === el.id ? { ...el, size: 'tall' } : e)),
          },
        });
      }
    }
    if (el.type === 'text' && !el.hidden && !el.text.trim()) {
      issues.push({
        id: `empty-text-${el.id}`,
        level: 'tip',
        title: 'An empty text piece',
        detail: 'Use a Space piece for empty lines.',
        elementId: el.id,
        fix: { label: 'Remove it', apply: (l) => l.filter((e) => e.id !== el.id) },
      });
    }
    if (el.hidden) continue;
    if (el.type === 'divider' && prev?.type === 'divider') {
      issues.push({
        id: `double-line-${el.id}`,
        level: 'tip',
        title: 'Two lines in a row',
        elementId: el.id,
        fix: { label: 'Remove one', apply: (l) => l.filter((e) => e.id !== el.id) },
      });
    }
    prev = el;
  }

  const firstShown = shown[0];
  const lastShown = shown.at(-1);
  for (const el of [firstShown, lastShown]) {
    if (el?.type === 'space') {
      issues.push({
        id: `edge-space-${el.id}`,
        level: 'tip',
        title: `Empty space at the ${el === firstShown ? 'top' : 'bottom'}`,
        detail: 'The printer already feeds paper before the cut.',
        elementId: el.id,
        fix: { label: 'Remove it', apply: (l) => l.filter((e) => e.id !== el.id) },
      });
      if (firstShown === lastShown) break;
    }
  }

  const hidden = layout.filter((e) => e.hidden);
  if (hidden.length && shown.length) {
    issues.push({
      id: 'hidden',
      level: 'tip',
      title: `${hidden.length} hidden piece${hidden.length > 1 ? 's are' : ' is'} not printed`,
      elementId: hidden[0]!.id,
      fix: {
        label: 'Delete hidden pieces',
        apply: (l) => l.filter((e) => !e.hidden || e.locked),
      },
    });
  }

  if ((ctx.estimateMm ?? 0) > 300) {
    issues.push({
      id: 'long-receipt',
      level: 'tip',
      title: `Long receipt: about ${Math.round((ctx.estimateMm ?? 0) / 10)} cm of paper`,
      detail: 'One line per item and no empty lines saves paper.',
      fix: { label: 'Save paper', apply: (l) => savePaper(l) },
    });
  }

  const order: Record<ReceiptIssueLevel, number> = { error: 0, warning: 1, tip: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

/** Roughly how long the printed receipt is, from its blocks (80 mm printers, 203 dpi). */
export function estimateBlocks(
  blocks: readonly ReceiptBlock[],
  charsPerLine: number,
): { lines: number; mm: number } {
  const LINE = 4.2;
  let lines = 0;
  let mm = 0;
  const textLines = (text: string, width: number) =>
    text
      .split('\n')
      .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / Math.max(1, width))), 0);
  for (const b of blocks) {
    switch (b.type) {
      case 'text': {
        const wide = b.large || b.wide;
        const n = textLines(b.text, wide ? Math.floor(charsPerLine / 2) : charsPerLine);
        lines += n;
        mm += n * LINE * (b.large || b.tall ? 2 : 1);
        break;
      }
      case 'row': {
        const width = b.large ? Math.floor(charsPerLine / 2) : charsPerLine;
        const n = b.left.length + b.right.length + 1 <= width ? 1 : 2;
        lines += n;
        mm += n * LINE * (b.large ? 2 : 1);
        break;
      }
      case 'divider':
        lines += 1;
        mm += LINE;
        break;
      case 'feed':
        lines += b.lines;
        mm += b.lines * LINE;
        break;
      case 'logo':
        mm += 22;
        break;
      case 'barcode':
        mm += 14;
        break;
      case 'qr':
        mm += b.size === 'small' ? 20 : b.size === 'large' ? 36 : 28;
        break;
      case 'cut':
        mm += 25;
        break;
    }
  }
  // Paper fed before the cut.
  return { lines, mm: Math.round(mm + 15) };
}

/** Human names for the options of a piece (for the comparison). */
const PROP_LABELS: Record<string, string> = {
  text: 'text',
  left: 'left text',
  right: 'right text',
  align: 'alignment',
  bold: 'bold',
  size: 'size',
  underline: 'underline',
  invert: 'white on black',
  style: 'style',
  lines: 'lines',
  layout: 'layout',
  showSku: 'item code',
  showDiscounts: 'discounts',
  showWarranty: 'warranty',
  showSerial: 'serial number',
  numbered: 'numbers',
  bigTotal: 'big total',
  simple: 'simple total',
  value: 'QR content',
  label: 'label',
  name: 'name',
  hidden: 'hidden',
  locked: 'locked',
  when: 'printed when',
};

/** Switches that are on when a design does not mention them (all others are off). */
const ON_BY_DEFAULT = new Set(['bigTotal']);
const SWITCHES = new Set([
  'underline',
  'invert',
  'numbered',
  'simple',
  'bigTotal',
  'hidden',
  'locked',
]);
const normalize = (key: string, v: unknown) =>
  v === undefined && SWITCHES.has(key) ? ON_BY_DEFAULT.has(key) : v;

function showValue(key: string, v: unknown): string {
  if (v === undefined || v === null || v === '') return key === 'when' ? 'Always' : '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (key === 'when') return RECEIPT_CONDITIONS[v as keyof typeof RECEIPT_CONDITIONS] ?? String(v);
  if (typeof v === 'string') {
    const one = prettyFields(v).replace(/\s+/g, ' ');
    return `"${one.length > 40 ? `${one.slice(0, 39)}…` : one}"`;
  }
  return String(v);
}

export interface LayoutChange {
  kind: 'added' | 'removed' | 'changed' | 'moved';
  id: string;
  label: string;
  /** For "changed": what changed, e.g. 'size: Normal → Big'. */
  details?: string[];
}

/**
 * What changed between two designs (pieces are matched by their id): added, removed, changed and
 * moved pieces. Only pieces that really moved are listed, not those pushed down by an addition.
 */
export function diffLayouts(
  before: readonly ReceiptElement[],
  after: readonly ReceiptElement[],
): LayoutChange[] {
  const out: LayoutChange[] = [];
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));

  for (const el of before)
    if (!afterById.has(el.id)) out.push({ kind: 'removed', id: el.id, label: describeElement(el) });

  // Pieces in both designs: the longest run kept in order did not move; the others did.
  const common = after.filter((e) => beforeById.has(e.id));
  const oldIndex = new Map(before.map((e, i) => [e.id, i]));
  const seq = common.map((e) => oldIndex.get(e.id)!);
  const stay = longestIncreasing(seq);

  after.forEach((el) => {
    const old = beforeById.get(el.id);
    if (!old) {
      out.push({ kind: 'added', id: el.id, label: describeElement(el) });
      return;
    }
    const details: string[] = [];
    if (old.type !== el.type) details.push(`type: ${old.type} → ${el.type}`);
    const keys = new Set([...Object.keys(old), ...Object.keys(el)]);
    for (const k of keys) {
      if (k === 'id' || k === 'type') continue;
      const a = normalize(k, (old as Record<string, unknown>)[k]);
      const b = normalize(k, (el as Record<string, unknown>)[k]);
      if (a !== b) {
        const label = PROP_LABELS[k] ?? k;
        details.push(
          k === 'size'
            ? `${label}: ${TEXT_SIZES[a as keyof typeof TEXT_SIZES] ?? a} → ${TEXT_SIZES[b as keyof typeof TEXT_SIZES] ?? b}`
            : `${label}: ${showValue(k, a)} → ${showValue(k, b)}`,
        );
      }
    }
    if (details.length)
      out.push({ kind: 'changed', id: el.id, label: describeElement(el), details });
  });
  common.forEach((el, i) => {
    if (!stay.has(i)) out.push({ kind: 'moved', id: el.id, label: describeElement(el) });
  });
  return out;
}

/** Positions (in `seq`) of one longest strictly increasing subsequence. */
function longestIncreasing(seq: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]!) keep.add(i);
  return keep;
}

/** A one-line summary of a comparison, e.g. "2 added · 1 changed". */
export function summarizeChanges(changes: readonly LayoutChange[]): string {
  if (!changes.length) return 'No differences';
  const count = (k: LayoutChange['kind']) => changes.filter((c) => c.kind === k).length;
  return (['added', 'removed', 'changed', 'moved'] as const)
    .map((k) => [k, count(k)] as const)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${k}`)
    .join(' · ');
}
