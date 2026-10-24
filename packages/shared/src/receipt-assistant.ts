import { z } from 'zod';
import { NUMBER_WORDS } from './assistant-words';
import {
  newReceiptElement,
  RECEIPT_CONDITIONS,
  RECEIPT_ELEMENT_INFO,
  RECEIPT_FIELDS,
  RECEIPT_TEMPLATES,
  receiptElementSchema,
  type ReceiptCondition,
  type ReceiptElement,
  type ReceiptElementType,
  type ReceiptField,
} from './receipt-layout';
import { describeElement, itemsSpot, prettyFields, savePaper } from './receipt-tools';

/**
 * The assistant of the receipt editor (Receipt Studio).
 *
 * Requests in plain words become a short list of actions from a fixed menu (add a piece, make
 * the total big, move the logo …). The built-in interpreter below understands the common ones
 * instantly and without internet; an AI, when the shop turns one on, produces the same actions
 * for everything else. Either way the actions are checked against the same rules as a change
 * made by hand, so the assistant can never do more than the editor allows.
 */

// ── Receipt actions ──

const TEMPLATE_KEYS = Object.keys(RECEIPT_TEMPLATES) as [
  keyof typeof RECEIPT_TEMPLATES,
  ...(keyof typeof RECEIPT_TEMPLATES)[],
];
const ELEMENT_TYPES = Object.keys(RECEIPT_ELEMENT_INFO) as [
  ReceiptElementType,
  ...ReceiptElementType[],
];
const CONDITIONS = Object.keys(RECEIPT_CONDITIONS) as [ReceiptCondition, ...ReceiptCondition[]];

export const RECEIPT_ACTION_OPS = [
  'add',
  'remove',
  'update',
  'move',
  'hide',
  'show',
  'lock',
  'unlock',
  'template',
  'copies',
  'replace',
  'savePaper',
  'check',
  'compare',
  'undo',
] as const;
export type ReceiptActionOp = (typeof RECEIPT_ACTION_OPS)[number];

/** One step the assistant wants to take on the receipt design (flat, so small models manage it). */
export const receiptActionSchema = z.object({
  op: z.enum(RECEIPT_ACTION_OPS),
  /** Which pieces: an id, a piece type (e.g. "totals"), words in the piece, "selected" or "all". */
  target: z.string().max(80).optional(),
  /** add: the kind of piece. */
  piece: z.enum(ELEMENT_TYPES).optional(),
  /** Text of a text piece, or the left side of a two-column piece. */
  text: z.string().max(500).optional(),
  /** Right side of a two-column piece. */
  right: z.string().max(200).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  bold: z.boolean().optional(),
  size: z.enum(['normal', 'tall', 'wide', 'large']).optional(),
  underline: z.boolean().optional(),
  invert: z.boolean().optional(),
  style: z.enum(['dashed', 'double', 'dotted', 'stars']).optional(),
  lines: z.int().min(1).max(5).optional(),
  /** QR code link or text. */
  value: z.string().max(300).optional(),
  qrSize: z.enum(['small', 'medium', 'large']).optional(),
  itemLayout: z.enum(['two-line', 'one-line']).optional(),
  showSku: z.boolean().optional(),
  showWarranty: z.boolean().optional(),
  showDiscounts: z.boolean().optional(),
  numbered: z.boolean().optional(),
  bigTotal: z.boolean().optional(),
  simple: z.boolean().optional(),
  when: z.enum(CONDITIONS).optional(),
  name: z.string().max(40).optional(),
  /** add / move: where. above/below need `anchor`. */
  position: z.enum(['top', 'bottom', 'up', 'down', 'above', 'below']).optional(),
  anchor: z.string().max(80).optional(),
  template: z.enum(TEMPLATE_KEYS).optional(),
  count: z.int().min(1).max(3).optional(),
  find: z.string().max(200).optional(),
  replace: z.string().max(200).optional(),
});
export type ReceiptAction = z.infer<typeof receiptActionSchema>;

const layoutSchema = z.array(receiptElementSchema).max(80);

/** Words people use for each kind of piece. */
const TYPE_WORDS: [RegExp, ReceiptElementType][] = [
  [/^logos?$/, 'logo'],
  [/^(grand )?totals?( amount| section)?$/, 'totals'],
  [/^(items?|item list|products?|goods)$/, 'items'],
  [/^(payments?|change|paid|payment details)$/, 'payments'],
  [/^(bill )?barcodes?$/, 'barcode'],
  [/^(qr|qr ?codes?)$/, 'qr'],
  [/^(lines?|dividers?|separators?|dashes|dashed lines?)$/, 'divider'],
  [/^(spaces?|gaps?|empty lines?|blank lines?)$/, 'space'],
  [/^(item count|count|number of items)$/, 'itemCount'],
  [/^(savings?|you saved|saved)$/, 'savings'],
  [/^(signatures?|signature lines?)$/, 'signature'],
  [/^(two columns?|pairs?|columns?)$/, 'pair'],
  [/^(texts?|all text|all the text|words)$/, 'text'],
];

/** Words people use for bill details printed in text pieces. */
const FIELD_WORDS: [RegExp, ReceiptField[]][] = [
  [/^(shop )?name$|^shop$/, ['shop_name']],
  [/^(shop )?address$/, ['shop_address']],
  [/^(shop )?(phone|telephone|tel|phone number)$/, ['shop_phone']],
  [/^(shop )?e-?mail$/, ['shop_email']],
  [/^vat( number| no)?$/, ['vat_no']],
  [/^(bill|invoice)( number| no)?$/, ['bill_no']],
  [/^(date|time|date and time)$/, ['date', 'day', 'time']],
  [/^cashier( name)?$/, ['cashier']],
  [/^customers?( name| details| phone)?$/, ['customer', 'customer_phone']],
  [/^(bill )?note$/, ['note']],
  [/^(price mode|retail|wholesale)$/, ['price_mode']],
];

function typeFromWords(words: string): ReceiptElementType | null {
  for (const [re, type] of TYPE_WORDS) if (re.test(words)) return type;
  return null;
}

function textOf(el: ReceiptElement): string {
  switch (el.type) {
    case 'text':
      return el.text;
    case 'pair':
      return `${el.left} ${el.right}`;
    case 'qr':
      return el.value;
    case 'signature':
      return el.label;
    default:
      return '';
  }
}

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/["“”'‘’]/g, '')
    .replace(/^(the|a|an|my|our)\s+/, '')
    .replace(/\s+(piece|pieces|part|section)$/, '')
    .trim();

/** The pieces a target means (see `receiptActionSchema.target`). */
export function resolveTargets(
  layout: readonly ReceiptElement[],
  target: string | undefined,
  selectedIds: readonly string[] = [],
): string[] {
  if (!target) return [...selectedIds];
  const t = clean(target);
  if (!t) return [...selectedIds];
  if (/^(selected|this|it|that|these|selection|the selected one)$/.test(t)) return [...selectedIds];
  if (/^(all|everything|every piece|all pieces|whole receipt)$/.test(t))
    return layout.map((e) => e.id);
  const byId = layout.find((e) => e.id === target.trim());
  if (byId) return [byId.id];
  const type = typeFromWords(t) ?? (t in RECEIPT_ELEMENT_INFO ? (t as ReceiptElementType) : null);
  if (type) return layout.filter((e) => e.type === type).map((e) => e.id);
  for (const [re, fields] of FIELD_WORDS) {
    if (re.test(t)) {
      const found = layout.filter((e) => fields.some((f) => textOf(e).includes(`{${f}}`)));
      if (found.length) return found.map((e) => e.id);
    }
  }
  // Words in the piece (as typed, or with fields shown as words), or its layer name.
  return layout
    .filter((e) => {
      const hay = `${textOf(e)} ${prettyFields(textOf(e))} ${e.name ?? ''}`.toLowerCase();
      return hay.includes(t);
    })
    .map((e) => e.id);
}

export interface ReceiptActionContext {
  copies: number;
  selectedIds?: readonly string[];
}

export interface ReceiptActionResult {
  layout: ReceiptElement[];
  copies: number;
  /** What was done, in words (shown in the chat and the history). */
  done: string[];
  /** What could not be done, and why. */
  problems: string[];
  /** The pieces to select afterwards (e.g. a new piece). */
  select: string[];
  /** The assistant asked to run the design check / compare with the saved design / undo. */
  check: boolean;
  compare: boolean;
  undo: boolean;
}

/** Options an action may change on a piece, for the kinds of piece that have them. */
function patchFor(el: ReceiptElement, a: ReceiptAction): Partial<ReceiptElement> {
  const p: Record<string, unknown> = {};
  const set = (key: string, v: unknown) => {
    if (v !== undefined) p[key] = v;
  };
  set('name', a.name);
  // "always" is the default, so it is stored as no condition.
  if (a.when) p.when = a.when === 'always' ? undefined : a.when;
  switch (el.type) {
    case 'logo':
      set('align', a.align);
      break;
    case 'text':
      set('text', a.text);
      set('align', a.align);
      set('bold', a.bold);
      set('size', a.size);
      set('underline', a.underline);
      set('invert', a.invert);
      break;
    case 'pair':
      set('left', a.text);
      set('right', a.right);
      set('bold', a.bold);
      if (a.size) p.size = a.size === 'large' || a.size === 'wide' ? 'large' : 'normal';
      break;
    case 'divider':
      set('style', a.style);
      break;
    case 'space':
      set('lines', a.lines);
      break;
    case 'items':
      set('layout', a.itemLayout);
      set('showSku', a.showSku);
      set('showWarranty', a.showWarranty);
      set('showDiscounts', a.showDiscounts);
      set('numbered', a.numbered);
      break;
    case 'totals':
      set('bigTotal', a.bigTotal ?? (a.size ? a.size !== 'normal' : undefined));
      set('simple', a.simple);
      break;
    case 'qr':
      set('value', a.value ?? a.text);
      set('size', a.qrSize);
      break;
    case 'signature':
      set('label', a.text);
      break;
  }
  return p as Partial<ReceiptElement>;
}

/** Where a new piece goes when the request does not say. */
function defaultSpot(layout: readonly ReceiptElement[], type: ReceiptElementType): number {
  const at = (t: ReceiptElementType) => layout.findIndex((e) => e.type === t);
  switch (type) {
    case 'logo':
      return 0;
    case 'items':
      return itemsSpot(layout);
    case 'totals':
      return at('items') >= 0 ? at('items') + 1 : layout.length;
    case 'payments':
      return at('totals') >= 0 ? at('totals') + 1 : layout.length;
    default:
      return layout.length;
  }
}

/** Carry out assistant actions on a design. Invalid results are refused, never half-applied. */
export function applyReceiptActions(
  start: readonly ReceiptElement[],
  actions: readonly ReceiptAction[],
  ctx: ReceiptActionContext,
): ReceiptActionResult {
  let layout = [...start];
  let copies = ctx.copies;
  let selected = [...(ctx.selectedIds ?? [])];
  const res = {
    done: [] as string[],
    problems: [] as string[],
    check: false,
    compare: false,
    undo: false,
  };
  const label = (id: string) => {
    const el = layout.find((e) => e.id === id);
    return el ? describeElement(el) : 'piece';
  };
  const list = (ids: string[]) =>
    ids.length > 3 ? `${ids.length} pieces` : ids.map((id) => `"${label(id)}"`).join(', ');

  for (const raw of actions) {
    const parsed = receiptActionSchema.safeParse(raw);
    if (!parsed.success) {
      res.problems.push('One step was not understood and was skipped.');
      continue;
    }
    const a = parsed.data;
    const targets = () => resolveTargets(layout, a.target, selected);
    const unlocked = (ids: string[]) => {
      const locked = ids.filter((id) => layout.find((e) => e.id === id)?.locked);
      if (locked.length) res.problems.push(`${list(locked)} is locked, so it was left as it is.`);
      return ids.filter((id) => !locked.includes(id));
    };
    const missing = () =>
      res.problems.push(
        a.target ? `I could not find "${a.target}" on the receipt.` : 'Select a piece first.',
      );

    switch (a.op) {
      case 'check':
        res.check = true;
        break;
      case 'compare':
        res.compare = true;
        break;
      case 'undo':
        res.undo = true;
        break;
      case 'template':
        if (!a.template) {
          res.problems.push('Which design? Classic, Compact, Minimal, Modern or Tax invoice.');
          break;
        }
        layout = RECEIPT_TEMPLATES[a.template].build();
        selected = [];
        res.done.push(`Started from the ${RECEIPT_TEMPLATES[a.template].label} design`);
        break;
      case 'copies':
        if (!a.count) break;
        copies = a.count;
        res.done.push(`Every receipt prints ${a.count} cop${a.count > 1 ? 'ies' : 'y'}`);
        break;
      case 'savePaper': {
        const before = layout.length;
        layout = savePaper(layout);
        res.done.push(
          `Saved paper: one line per item${before > layout.length ? `, ${before - layout.length} empty or repeated lines removed` : ''}`,
        );
        break;
      }
      case 'add': {
        const type = a.piece ?? (a.value ? 'qr' : 'text');
        const el = newReceiptElement(type);
        const filled = { ...el, ...patchFor(el, a) } as Record<string, unknown>;
        for (const k of Object.keys(filled)) if (filled[k] === undefined) delete filled[k];
        // With no place given, a new piece goes under the selected one (like the Add buttons).
        const anchorIds = a.anchor ? resolveTargets(layout, a.anchor, []) : selected;
        if (a.anchor && !anchorIds.length)
          res.problems.push(`I could not find "${a.anchor}", so it went in the usual place.`);
        const first = layout.findIndex((e) => e.id === anchorIds[0]);
        const last = layout.findIndex((e) => e.id === anchorIds.at(-1));
        let pos = defaultSpot(layout, type);
        if (a.position === 'top') pos = type !== 'logo' && layout[0]?.type === 'logo' ? 1 : 0;
        else if (a.position === 'bottom') pos = layout.length;
        else if (a.position === 'above' && first >= 0) pos = first;
        else if ((a.position === 'below' || !a.position) && last >= 0) pos = last + 1;
        const piece = filled as ReceiptElement;
        layout = [...layout.slice(0, pos), piece, ...layout.slice(pos)];
        selected = [piece.id];
        res.done.push(
          `Added ${RECEIPT_ELEMENT_INFO[type].label.toLowerCase()} "${describeElement(piece)}"`,
        );
        break;
      }
      case 'remove': {
        const ids = unlocked(targets());
        if (!ids.length) {
          if (!res.problems.length) missing();
          break;
        }
        res.done.push(`Removed ${list(ids)}`);
        layout = layout.filter((e) => !ids.includes(e.id));
        selected = selected.filter((id) => !ids.includes(id));
        break;
      }
      case 'hide':
      case 'show':
      case 'lock':
      case 'unlock': {
        const ids = a.op === 'unlock' ? targets() : unlocked(targets());
        if (!ids.length) {
          if (!res.problems.length) missing();
          break;
        }
        const key = a.op === 'hide' || a.op === 'show' ? 'hidden' : 'locked';
        const value = a.op === 'hide' || a.op === 'lock';
        layout = layout.map((e) => (ids.includes(e.id) ? { ...e, [key]: value } : e));
        res.done.push(
          `${{ hide: 'Hid', show: 'Showed', lock: 'Locked', unlock: 'Unlocked' }[a.op]} ${list(ids)}`,
        );
        break;
      }
      case 'update': {
        const ids = unlocked(targets());
        if (!ids.length) {
          if (!res.problems.length) missing();
          break;
        }
        let changed = 0;
        layout = layout.map((e) => {
          if (!ids.includes(e.id)) return e;
          const patch = patchFor(e, a);
          if (!Object.keys(patch).length) return e;
          changed++;
          const next = { ...e, ...patch } as Record<string, unknown>;
          for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
          return next as ReceiptElement;
        });
        if (changed) res.done.push(`Changed ${list(ids)}`);
        else res.problems.push(`That option does not apply to ${list(ids)}.`);
        break;
      }
      case 'move': {
        const ids = unlocked(targets());
        if (!ids.length) {
          if (!res.problems.length) missing();
          break;
        }
        const moving = layout.filter((e) => ids.includes(e.id));
        const rest = layout.filter((e) => !ids.includes(e.id));
        const firstOld = layout.findIndex((e) => ids.includes(e.id));
        let pos: number;
        if (a.position === 'top') pos = 0;
        else if (a.position === 'bottom') pos = rest.length;
        else if (a.position === 'up') pos = Math.max(0, firstOld - 1);
        else if (a.position === 'down') pos = Math.min(rest.length, firstOld + 1);
        else {
          const anchor = resolveTargets(rest, a.anchor, []).at(a.position === 'below' ? -1 : 0);
          const i = rest.findIndex((e) => e.id === anchor);
          if (i < 0) {
            res.problems.push(`Where to? I could not find "${a.anchor ?? ''}".`);
            break;
          }
          pos = a.position === 'below' ? i + 1 : i;
        }
        layout = [...rest.slice(0, pos), ...moving, ...rest.slice(pos)];
        res.done.push(
          `Moved ${list(ids)} ${a.position === 'above' || a.position === 'below' ? `${a.position} "${a.anchor}"` : a.position === 'up' || a.position === 'down' ? a.position : `to the ${a.position ?? 'new place'}`}`,
        );
        break;
      }
      case 'replace': {
        if (!a.find) break;
        const find = a.find;
        const repl = a.replace ?? '';
        const scope = a.target ? targets() : layout.map((e) => e.id);
        let n = 0;
        const swap = (s: string) => {
          if (!s.toLowerCase().includes(find.toLowerCase())) return s;
          n++;
          return s.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), repl);
        };
        layout = layout.map((e) => {
          if (!scope.includes(e.id) || e.locked) return e;
          switch (e.type) {
            case 'text':
              return { ...e, text: swap(e.text) };
            case 'pair':
              return { ...e, left: swap(e.left), right: swap(e.right) };
            case 'qr':
              return { ...e, value: swap(e.value) };
            case 'signature':
              return { ...e, label: swap(e.label) };
            default:
              return e;
          }
        });
        if (n) res.done.push(`Replaced "${find}" with "${repl}" in ${n} place${n > 1 ? 's' : ''}`);
        else res.problems.push(`"${find}" is not on the receipt.`);
        break;
      }
    }
  }

  const valid = layoutSchema.safeParse(layout);
  if (!valid.success) {
    return {
      layout: [...start],
      copies: ctx.copies,
      done: [],
      problems: [
        `The change would make an invalid receipt, so nothing was changed (${valid.error.issues[0]?.message ?? 'invalid'}).`,
      ],
      select: [...(ctx.selectedIds ?? [])],
      check: false,
      compare: false,
      undo: false,
    };
  }
  return {
    layout: valid.data,
    copies,
    select: selected.filter((id) => layout.some((e) => e.id === id)),
    ...res,
  };
}

// ── Built-in receipt interpreter ──

export interface AssistantReply<A> {
  /** False when the request was not understood (the local AI model may then be asked). */
  understood: boolean;
  reply: string;
  actions: A[];
}

export const RECEIPT_ASSISTANT_EXAMPLES = [
  'Check my receipt',
  'Make the total big',
  'Add WhatsApp 0771234567',
  'Add "No returns after 7 days" at the bottom',
  'Save paper',
  'Use the modern design',
  'Hide the barcode',
  'Show item codes',
  'Only print signature on credit',
  'Compare with saved',
];

const POSITION_RE =
  /\s+(?:(at the |on |to the |to )?(top|bottom|end|start|beginning)|(above|before|over|under|below|after|beneath)\s+(?:the\s+)?(.+))$/;

function splitPosition(rest: string): {
  body: string;
  position?: ReceiptAction['position'];
  anchor?: string;
} {
  const m = POSITION_RE.exec(rest);
  if (!m) return { body: rest };
  const body = rest.slice(0, m.index).trim();
  if (m[2])
    return {
      body,
      position: m[2] === 'top' || m[2] === 'start' || m[2] === 'beginning' ? 'top' : 'bottom',
    };
  const before = m[3] === 'above' || m[3] === 'before' || m[3] === 'over';
  return { body, position: before ? 'above' : 'below', anchor: m[4]!.trim() };
}

/** "0771234567" → "94771234567" (Sri Lankan numbers without the country code). */
function waNumber(raw: string) {
  const digits = raw.replace(/[^\d]/g, '');
  return /^0\d{9}$/.test(digits) ? `94${digits.slice(1)}` : digits;
}

const QUOTED = /["“'‘]([^"”'’]+)["”'’]/;

/** Ready-made texts for "add a thank you", "add return policy" … */
const TEXT_PRESETS: [RegExp, Partial<ReceiptAction>][] = [
  [
    /^(a )?thank ?you( message| note| line)?$|^thanks$/,
    { text: 'Thank you! Please come again.', bold: true },
  ],
  [
    /^(a )?return(s)? policy$|^exchange policy$/,
    { text: 'Goods once sold can be exchanged within 7 days with the bill.' },
  ],
  [/^vat( number| no)?$/, { text: 'VAT No: {vat_no}' }],
  [
    /^customer( name| details| info)?$/,
    { text: 'Customer: {customer} {customer_phone}', align: 'left', when: 'customer' },
  ],
  [/^cashier( name)?$/, { text: 'Cashier: {cashier}', align: 'left' }],
  [/^(the )?(date|time|date and time)$/, { text: 'Date: {date}', align: 'left' }],
  [/^(the )?(bill|invoice)( number| no)?$/, { text: 'Bill: {bill_no}', align: 'left' }],
  [/^(shop )?(phone|telephone)( number)?$/, { text: 'Tel: {shop_phone}' }],
  [/^(shop )?address$/, { text: '{shop_address}' }],
  [/^(shop )?e-?mail$/, { text: '{shop_email}' }],
  [/^(shop )?name$/, { text: '{shop_name}', bold: true }],
  [/^(bill )?note$/, { text: 'Note: {note}', align: 'left' }],
  [/^(the )?total in words|^total line$/, { text: 'Total: {total}', bold: true }],
];

const STYLE_WORDS: [RegExp, Partial<ReceiptAction>][] = [
  [/^(bigger|big|large|larger|huge|very big)$/, { size: 'large' }],
  [/^(tall|taller|higher)$/, { size: 'tall' }],
  [/^(wide|wider)$/, { size: 'wide' }],
  [/^(small|smaller|normal|normal size|regular)$/, { size: 'normal' }],
  [/^(bold|thick|strong|darker)$/, { bold: true }],
  [/^(not bold|unbold|thin|normal weight|lighter)$/, { bold: false }],
  [/^(underlined|underline)$/, { underline: true }],
  [/^(not underlined|no underline)$/, { underline: false }],
  [/^(highlighted|inverted|white on black|reversed|stand out)$/, { invert: true }],
  [/^(not highlighted|not inverted|normal colou?rs?)$/, { invert: false }],
  [/^(centered|centred|center|centre|in the middle|middle)$/, { align: 'center' }],
  [/^(left|left aligned|on the left)$/, { align: 'left' }],
  [/^(right|right aligned|on the right)$/, { align: 'right' }],
];

function styleFrom(words: string): Partial<ReceiptAction> | null {
  const parts = words.split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
  const out: Partial<ReceiptAction> = {};
  for (const part of parts) {
    const hit = STYLE_WORDS.find(([re]) => re.test(part.trim()));
    if (!hit) return null;
    Object.assign(out, hit[1]);
  }
  return Object.keys(out).length ? out : null;
}

const CONDITION_WORDS: [RegExp, ReceiptCondition][] = [
  [/credit|on account/, 'credit'],
  [/card/, 'card'],
  [/cash/, 'cash'],
  [/quotations?|quotes?/, 'quote'],
  [/reprints?|copies/, 'reprint'],
  [/wholesale/, 'wholesale'],
  [/retail/, 'retail'],
  [/discounts?/, 'discount'],
  [/warrant(y|ies)/, 'warranty'],
  [/(a )?customers?/, 'customer'],
];

const ITEM_OPTIONS: [RegExp, keyof ReceiptAction][] = [
  [/item codes?|sku|codes?/, 'showSku'],
  [/warrant(y|ies)/, 'showWarranty'],
  [/(item )?discounts?/, 'showDiscounts'],
  [/numbers|numbering|item numbers/, 'numbered'],
];

/** Understand one plain request about the receipt (one clause). */
function interpretReceiptClause(
  clause: string,
  layout: readonly ReceiptElement[],
  selectedIds: readonly string[],
): ReceiptAction[] | null {
  const exists = (target: string | undefined) =>
    resolveTargets(layout, target, selectedIds).length > 0;
  // `raw` keeps the letter case (for texts to print); `s` is the same in lower case.
  const raw = clause
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/^(please|can you|could you|pls|kindly)\s+/i, '')
    .replace(/\s+please$/i, '');
  const quoted = QUOTED.exec(raw)?.[1];
  const s = raw.toLowerCase();

  if (
    /^(check|preflight|review|test)\b|any (problems|mistakes|errors|issues)|what('?s| is) wrong|is (it|this|my receipt|the receipt) (ok|okay|good|right|fine)/.test(
      s,
    )
  )
    return [{ op: 'check' }];
  if (/\b(compare|what (has )?changed|differences?|diff)\b/.test(s)) return [{ op: 'compare' }];
  if (/^(undo|go back|revert that|undo that)$/.test(s)) return [{ op: 'undo' }];
  if (
    /\b(save|less|use less) paper\b|^(make (it|the receipt|receipt) )?(shorter|short|smaller)$|^shorten/.test(
      s,
    )
  )
    return [{ op: 'savePaper' }];

  const tpl =
    /\b(classic|compact|minimal|modern|tax invoice|invoice)\b(?:\s+(design|template|style|layout|receipt))?/.exec(
      s,
    );
  if (
    tpl &&
    /\b(use|apply|switch|start|change|make it|go)\b|^(classic|compact|minimal|modern|tax invoice|invoice)( design| template| style| layout)?$/.test(
      s,
    )
  ) {
    const key =
      tpl[1] === 'tax invoice' || tpl[1] === 'invoice'
        ? 'invoice'
        : (tpl[1] as ReceiptAction['template']);
    return [{ op: 'template', template: key }];
  }

  const copies = /\b(\d|one|two|three|single|double)\s+(copies|copy)\b/.exec(s);
  if (copies) {
    const n = NUMBER_WORDS[copies[1]!] ?? Number(copies[1]);
    if (n >= 1 && n <= 3) return [{ op: 'copies', count: n }];
  }

  // WhatsApp, Facebook, website and review QR codes.
  const wa = /whats ?app\D*(\+?\d[\d\s-]{6,}\d)/.exec(s);
  if (wa) {
    return [
      { op: 'add', piece: 'qr', value: `https://wa.me/${waNumber(wa[1]!)}`, position: 'bottom' },
      { op: 'add', piece: 'text', text: 'Chat with us on WhatsApp', position: 'bottom' },
    ];
  }
  const url =
    /((?:https?:\/\/|www\.)[^\s"']+|\b[a-z0-9-]+\.(?:com|lk|net|org|shop|store|me)(?:\/[^\s"']*)?)/i.exec(
      raw,
    )?.[1];
  if (
    url &&
    /\b(qr|facebook|fb|instagram|insta|tiktok|website|web ?site|site|review|google|link|page)\b/.test(
      s,
    )
  ) {
    const link = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const caption = /facebook|fb\b/.test(s)
      ? 'Follow us on Facebook'
      : /instagram|insta/.test(s)
        ? 'Follow us on Instagram'
        : /tiktok/.test(s)
          ? 'Follow us on TikTok'
          : /review|google/.test(s)
            ? 'Please rate us on Google'
            : 'Visit our website';
    return [
      { op: 'add', piece: 'qr', value: link, position: 'bottom' },
      { op: 'add', piece: 'text', text: caption, position: 'bottom' },
    ];
  }

  // Item list options.
  if (/\b(one|single|1)[- ]line\b|items? (on|in) one line/.test(s) && /item|product|line/.test(s))
    return [{ op: 'update', target: 'items', itemLayout: 'one-line' }];
  if (/\b(two|2)[- ]lines?\b/.test(s) && /item|product/.test(s))
    return [{ op: 'update', target: 'items', itemLayout: 'two-line' }];
  const itemOpt =
    /^(show|hide|turn on|turn off|add|remove|print|don'?t print|do not print|with|without|no)\s+(?:the\s+)?(.+?)(?:\s+(?:on|for|of) (?:the )?items?)?$/.exec(
      s,
    );
  if (itemOpt) {
    const what = itemOpt[2]!;
    const opt = ITEM_OPTIONS.find(([re]) => new RegExp(`^(${re.source})$`).test(what));
    if (opt && layout.some((e) => e.type === 'items')) {
      const on = /^(show|turn on|add|print|with)$/.test(itemOpt[1]!);
      return [{ op: 'update', target: 'items', [opt[1]]: on }];
    }
  }
  if (/^number (the )?items$/.test(s)) return [{ op: 'update', target: 'items', numbered: true }];
  if (/\bsimple total\b|only (the )?total( line)?$/.test(s))
    return [{ op: 'update', target: 'totals', simple: true }];
  if (/\b(full|detailed) total/.test(s)) return [{ op: 'update', target: 'totals', simple: false }];

  // Print only on some bills: "only print the signature on credit sales".
  const only =
    /^(?:only|just)\s+(?:print|show)\s+(?:the\s+)?(.+?)\s+(?:on|for|when|with|if)\s+(.+)$/.exec(
      s,
    ) ?? /^(?:print|show)\s+(?:the\s+)?(.+?)\s+only\s+(?:on|for|when|with|if)\s+(.+)$/.exec(s);
  if (only) {
    const cond = CONDITION_WORDS.find(([re]) => re.test(only[2]!));
    if (cond) return [{ op: 'update', target: only[1], when: cond[1] }];
  }
  const always = /^(?:always)\s+(?:print|show)\s+(?:the\s+)?(.+)$/.exec(s);
  if (always) return [{ op: 'update', target: always[1], when: 'always' }];

  // Replace words: replace "Thank you" with "Thanks".
  const repl =
    /^(?:replace|change|swap)\s+["“'‘]([^"”'’]+)["”'’]\s+(?:with|to|into|for)\s+["“'‘]?([^"”'’]*)["”'’]?$/i.exec(
      raw,
    );
  if (repl) return [{ op: 'replace', find: repl[1]!, replace: repl[2]! }];

  // Style: "make the total big", "make shop name bold and centered", "center everything".
  const make =
    /^(?:make|set|turn|change|put)\s+(?:the\s+)?(.+?)\s+(?:to\s+|into\s+|in\s+)?((?:very |a bit )?[a-z ,]+?)$/.exec(
      s,
    );
  if (make) {
    // Try every split between "what" and "how", longest "what" first.
    const words = `${make[1]} ${make[2]}`.split(' ');
    for (let cut = words.length - 1; cut >= 1; cut--) {
      const target = words
        .slice(0, cut)
        .join(' ')
        .replace(/\s+(to|into|in)$/, '');
      const style = styleFrom(
        words
          .slice(cut)
          .join(' ')
          .replace(/^(very|a bit)\s+/, ''),
      );
      if (style && exists(target)) {
        return [{ op: 'update', target, ...style }];
      }
    }
  }
  const styleFirst =
    /^(bold|underline|highlight|center|centre|align left|align right|left align|right align)\s+(?:the\s+)?(.+)$/.exec(
      s,
    );
  if (styleFirst) {
    const w = styleFirst[1]!;
    const style: Partial<ReceiptAction> =
      w === 'bold'
        ? { bold: true }
        : w === 'underline'
          ? { underline: true }
          : w === 'highlight'
            ? { invert: true }
            : /left/.test(w)
              ? { align: 'left' }
              : /right/.test(w)
                ? { align: 'right' }
                : { align: 'center' };
    const target = /^(all|everything|all text|all the text)$/.test(styleFirst[2]!)
      ? 'text'
      : styleFirst[2]!;
    return [{ op: 'update', target, ...style }];
  }

  // Sideways: "move the logo to the left", "logo right", "shift the shop name to the centre".
  const side =
    /^(?:(?:move|put|place|shift|align|bring)\s+)?(?:the\s+)?(.+?)\s+(?:to\s+(?:the\s+)?|on\s+(?:the\s+)?|in\s+(?:the\s+)?)?(left|right|cent(?:er|re)|middle)(?:\s+side)?$/.exec(
      s,
    );
  if (side && !/\b(up|down|top|bottom)\b/.test(side[1]!)) {
    const align = side[2] === 'left' ? 'left' : side[2] === 'right' ? 'right' : 'center';
    return [{ op: 'update', target: side[1], align }];
  }

  // Move: "move the logo to the top", "move barcode below the total", "move qr up".
  const mv =
    /^(?:move|put|place|bring)\s+(?:the\s+)?(.+?)\s+(up|down|(?:to the |at the |on )?(?:top|bottom|end|start)|(?:above|before|over|below|under|after|beneath)\s+(?:the\s+)?.+)$/.exec(
      s,
    );
  if (mv) {
    const where = mv[2]!;
    if (where === 'up' || where === 'down') return [{ op: 'move', target: mv[1], position: where }];
    const p = splitPosition(` ${where}`);
    if (p.position) return [{ op: 'move', target: mv[1], position: p.position, anchor: p.anchor }];
  }

  // Hide / show / lock.
  const vis =
    /^(hide|unhide|show|don'?t print|do not print|stop printing|lock|unlock)\s+(?:the\s+)?(.+)$/.exec(
      s,
    );
  if (vis) {
    const verb = vis[1]!;
    const op: ReceiptAction['op'] =
      verb === 'unhide' || verb === 'show'
        ? 'show'
        : verb === 'lock'
          ? 'lock'
          : verb === 'unlock'
            ? 'unlock'
            : 'hide';
    if (exists(vis[2])) return [{ op, target: vis[2] }];
  }

  // Remove: "remove the logo", "delete all spaces".
  const rm =
    /^(?:remove|delete|take out|drop|get rid of|erase|clear)\s+(?:all\s+)?(?:the\s+)?(.+)$/.exec(s);
  if (rm) return [{ op: 'remove', target: rm[1] }];

  // Add: quoted text, presets and pieces, with an optional place.
  const add =
    /^(?:add|insert|put|write|print|include|place|create)\s+(?:a\s+|an\s+|the\s+|some\s+)?(.+)$/.exec(
      s,
    );
  if (add) {
    // Words inside quotes are the text to print, never the place ("… after 7 days" at the bottom).
    const { body, position, anchor } = splitPosition(add[1]!.replace(/["“'‘][^"”'’]+["”'’]/, '§'));
    const where = { ...(position && { position }), ...(anchor && { anchor }) };
    if (quoted) {
      const big = /\b(big|large|bold)\b/.test(body.replace(QUOTED, ''));
      return [{ op: 'add', piece: 'text', text: quoted, ...where, ...(big && { bold: true }) }];
    }
    const preset = TEXT_PRESETS.find(([re]) => re.test(body));
    if (preset) return [{ op: 'add', piece: 'text', ...preset[1], ...where }];
    const words = body.replace(/\s+(piece|section)$/, '');
    if (/^(qr|qr ?code)$/.test(words)) return [{ op: 'add', piece: 'qr', ...where }];
    if (/^(double|dotted|star|stars|dashed)( line| divider)?$/.test(words)) {
      const style = words.startsWith('double')
        ? 'double'
        : words.startsWith('dotted')
          ? 'dotted'
          : words.startsWith('star')
            ? 'stars'
            : 'dashed';
      return [{ op: 'add', piece: 'divider', style, ...where }];
    }
    const type = typeFromWords(words);
    if (type) return [{ op: 'add', piece: type, ...where }];
    const text = /^(?:text|line|message|note|footer|header)\s+(?:saying|that says|:)?\s*(.+)$/.exec(
      body,
    );
    if (text) {
      const at = s.indexOf(text[1]!);
      return [{ op: 'add', piece: 'text', text: raw.slice(at, at + text[1]!.length), ...where }];
    }
  }
  return null;
}

/**
 * The built-in receipt assistant: understands common requests in plain English, several at once
 * ("make the total big and add a thank you"). Instant, works offline, and never guesses: what it
 * does not understand it says so (and the local AI model, if on, gets the request instead).
 */
export function interpretReceiptCommand(
  message: string,
  layout: readonly ReceiptElement[],
  selectedIds: readonly string[] = [],
): AssistantReply<ReceiptAction> {
  const text = message.trim();
  if (!text) return { understood: false, reply: 'Type what you want to change.', actions: [] };
  if (/^(help|\?|what can you do|how does this work|examples?)\??$/i.test(text)) {
    return {
      understood: true,
      reply: `Tell me what to change, for example:\n• ${RECEIPT_ASSISTANT_EXAMPLES.join('\n• ')}`,
      actions: [],
    };
  }
  const clauses = text
    .split(/\s*(?:;|\n|,?\s+and then\s+|,?\s+then\s+|,?\s+also\s+|\.\s+)\s*/i)
    .flatMap((c) => splitAnd(c))
    .filter(Boolean);
  const actions: ReceiptAction[] = [];
  let lastTarget: string | undefined;
  for (const clause of clauses) {
    let found = interpretReceiptClause(clause, layout, selectedIds);
    // "make the total big and bold": the second half has no piece of its own.
    if (!found && lastTarget) {
      const style = styleFrom(clause.toLowerCase().trim());
      if (style) found = [{ op: 'update', target: lastTarget, ...style }];
    }
    if (!found) return { understood: false, reply: notUnderstood(clause), actions: [] };
    lastTarget = found.at(-1)?.target ?? lastTarget;
    actions.push(...found);
  }
  return { understood: true, reply: '', actions };
}

/** Split on "and" only where both halves look like separate requests. */
function splitAnd(clause: string): string[] {
  const parts = clause.split(/\s+and\s+/i);
  if (parts.length < 2) return [clause];
  const verb =
    /^(make|set|add|insert|put|remove|delete|hide|show|move|use|center|centre|bold|underline|highlight|lock|unlock|replace|change|save|check|compare|only|print|don'?t)\b/i;
  const out: string[] = [parts[0]!];
  for (const p of parts.slice(1)) {
    if (verb.test(p) || styleFrom(p.toLowerCase())) out.push(p);
    else out[out.length - 1] += ` and ${p}`;
  }
  return out;
}

function notUnderstood(clause: string) {
  return `I did not understand "${clause.trim()}". Try for example: "${RECEIPT_ASSISTANT_EXAMPLES[1]}", "${RECEIPT_ASSISTANT_EXAMPLES[3]}" or "${RECEIPT_ASSISTANT_EXAMPLES[6]}".`;
}

export const RECEIPT_FIELD_HELP = (Object.keys(RECEIPT_FIELDS) as ReceiptField[])
  .map((f) => `{${f}} = ${RECEIPT_FIELDS[f]}`)
  .join(', ');

/** Approval actions for prompts: "VOID_SALE = Void a bill". */
