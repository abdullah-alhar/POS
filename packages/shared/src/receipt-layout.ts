import { z } from 'zod';

/**
 * The receipt design: a list of pieces printed from top to bottom (receipt printers print line by
 * line, so pieces can be moved up and down). Text may contain {fields} filled in from the bill.
 */
export const RECEIPT_FIELDS = {
  shop_name: 'Shop name',
  shop_address: 'Shop address',
  shop_phone: 'Shop phone',
  shop_email: 'Shop email',
  vat_no: 'VAT number',
  bill_no: 'Bill number',
  date: 'Date and time',
  day: 'Date',
  time: 'Time',
  cashier: 'Cashier',
  customer: 'Customer name',
  customer_phone: 'Customer phone',
  price_mode: 'Retail / Wholesale',
  total: 'Bill total',
  item_count: 'Number of items',
  payment_method: 'Paid by',
  note: 'Bill note',
} as const;
export type ReceiptField = keyof typeof RECEIPT_FIELDS;

/**
 * When a piece is printed. Most pieces are printed on every bill; these let the shop print a piece
 * only on some bills (e.g. "Pay within 30 days" only on credit sales).
 */
export const RECEIPT_CONDITIONS = {
  always: 'Always',
  customer: 'A customer is on the bill',
  noCustomer: 'No customer on the bill',
  cash: 'Paid with cash',
  card: 'Paid by card',
  credit: 'Sold on credit',
  discount: 'The bill has a discount',
  warranty: 'An item has a warranty',
  wholesale: 'Wholesale bill',
  retail: 'Retail bill',
  notQuote: 'Not on quotations',
  quote: 'Only on quotations',
  reprint: 'Only on reprints',
} as const;
export type ReceiptCondition = keyof typeof RECEIPT_CONDITIONS;
const conditionKeys = Object.keys(RECEIPT_CONDITIONS) as [ReceiptCondition, ...ReceiptCondition[]];

export const TEXT_SIZES = {
  normal: 'Normal',
  tall: 'Tall',
  wide: 'Wide',
  large: 'Big',
} as const;
export type TextSize = keyof typeof TEXT_SIZES;

export const DIVIDER_STYLES = {
  dashed: '- - - - - -',
  double: '==========',
  dotted: '. . . . . .',
  stars: '* * * * * *',
} as const;
export type DividerStyle = keyof typeof DIVIDER_STYLES;

const id = z.string().min(1).max(40);
const align = z.enum(['left', 'center', 'right']);

/**
 * What every piece has, like a layer in a design app: an optional name, hidden (kept in the
 * design but not printed), locked (cannot be moved or changed by accident) and when it is printed.
 * All optional, so designs saved by older versions stay valid.
 */
const layer = {
  id,
  name: z.string().trim().max(40).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  when: z.enum(conditionKeys).optional(),
};

export const receiptElementSchema = z.discriminatedUnion('type', [
  z.object({ ...layer, type: z.literal('logo') }),
  z.object({
    ...layer,
    type: z.literal('text'),
    text: z.string().max(500),
    align,
    bold: z.boolean(),
    size: z.enum(['normal', 'large', 'tall', 'wide']),
    underline: z.boolean().optional(),
    /** White letters on black (a highlight band). */
    invert: z.boolean().optional(),
  }),
  z.object({
    ...layer,
    type: z.literal('pair'),
    left: z.string().max(200),
    right: z.string().max(200),
    bold: z.boolean(),
    size: z.enum(['normal', 'large']),
  }),
  z.object({
    ...layer,
    type: z.literal('divider'),
    style: z.enum(['dashed', 'double', 'dotted', 'stars']),
  }),
  z.object({ ...layer, type: z.literal('space'), lines: z.int().min(1).max(5) }),
  z.object({
    ...layer,
    type: z.literal('items'),
    layout: z.enum(['two-line', 'one-line']),
    showSku: z.boolean(),
    showDiscounts: z.boolean(),
    showWarranty: z.boolean(),
    showSerial: z.boolean(),
    /** 1., 2., 3. in front of each item. */
    numbered: z.boolean().optional(),
  }),
  z.object({
    ...layer,
    type: z.literal('totals'),
    /** Print TOTAL in big letters (default on). */
    bigTotal: z.boolean().optional(),
    /** Only the TOTAL line, without subtotal, discounts and rounding. */
    simple: z.boolean().optional(),
  }),
  z.object({ ...layer, type: z.literal('payments') }),
  z.object({ ...layer, type: z.literal('itemCount') }),
  z.object({ ...layer, type: z.literal('savings') }),
  z.object({ ...layer, type: z.literal('barcode') }),
  z.object({
    ...layer,
    type: z.literal('qr'),
    value: z.string().max(300),
    size: z.enum(['small', 'medium', 'large']).optional(),
  }),
  z.object({ ...layer, type: z.literal('signature'), label: z.string().max(60) }),
]);
export type ReceiptElement = z.infer<typeof receiptElementSchema>;
export type ReceiptElementType = ReceiptElement['type'];
export type ReceiptElementOf<T extends ReceiptElementType> = Extract<ReceiptElement, { type: T }>;

/** Names and one-line explanations, for the "Add" panel of the receipt editor. */
export const RECEIPT_ELEMENT_INFO: Record<ReceiptElementType, { label: string; hint: string }> = {
  text: { label: 'Text', hint: 'Any words, with fields like the bill number' },
  pair: { label: 'Two columns', hint: 'Words on the left and right of one line' },
  logo: { label: 'Logo', hint: 'The shop logo' },
  divider: { label: 'Line', hint: 'A dashed line across the paper' },
  space: { label: 'Space', hint: 'An empty line' },
  items: { label: 'Items', hint: 'What was bought' },
  totals: { label: 'Total', hint: 'Subtotal, discounts and TOTAL' },
  payments: { label: 'Payment', hint: 'Cash / card paid and change' },
  itemCount: { label: 'Item count', hint: '"Items: 4"' },
  savings: { label: 'You saved', hint: '"You saved Rs 450 today!"' },
  barcode: { label: 'Bill barcode', hint: 'Scan it for fast returns' },
  qr: { label: 'QR code', hint: 'WhatsApp, Facebook or a review link' },
  signature: { label: 'Signature', hint: 'A line to sign on' },
};

/** Pieces that show the bill itself; a receipt normally has each of them once. */
export const RECEIPT_SINGLE_PIECES: ReceiptElementType[] = ['items', 'totals', 'payments'];

let counter = 0;
/** A short unique id for a new piece. */
export function newElementId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A new piece of the given type with sensible starting values. */
export function newReceiptElement<T extends ReceiptElementType>(type: T): ReceiptElementOf<T>;
export function newReceiptElement(type: ReceiptElementType): ReceiptElement {
  const id = newElementId();
  switch (type) {
    case 'text':
      return { id, type, text: 'New text', align: 'center', bold: false, size: 'normal' };
    case 'pair':
      return { id, type, left: 'Bill: {bill_no}', right: '{date}', bold: false, size: 'normal' };
    case 'divider':
      return { id, type, style: 'dashed' };
    case 'space':
      return { id, type, lines: 1 };
    case 'items':
      return {
        id,
        type,
        layout: 'two-line',
        showSku: false,
        showDiscounts: true,
        showWarranty: true,
        showSerial: true,
      };
    case 'qr':
      return { id, type, value: 'https://wa.me/94771234567' };
    case 'signature':
      return { id, type, label: 'Customer signature' };
    default:
      return { id, type };
  }
}

const text = (
  t: string,
  opts: Partial<{
    align: 'left' | 'center' | 'right';
    bold: boolean;
    size: 'normal' | 'large' | 'tall' | 'wide';
    invert: boolean;
    when: ReceiptCondition;
  }> = {},
) =>
  ({
    id: newElementId(),
    type: 'text',
    text: t,
    align: opts.align ?? 'center',
    bold: opts.bold ?? false,
    size: opts.size ?? 'normal',
    ...(opts.invert && { invert: true }),
    ...(opts.when && { when: opts.when }),
  }) as const;
const pair = (left: string, right: string) =>
  ({ id: newElementId(), type: 'pair', left, right, bold: false, size: 'normal' }) as const;
const line = (style: DividerStyle = 'dashed') =>
  ({ id: newElementId(), type: 'divider', style }) as const;
const items = (layout: 'two-line' | 'one-line' = 'two-line') =>
  ({
    id: newElementId(),
    type: 'items',
    layout,
    showSku: false,
    showDiscounts: true,
    showWarranty: true,
    showSerial: true,
  }) as const;

/** Ready-made designs to start from. */
export const RECEIPT_TEMPLATES: Record<
  'classic' | 'compact' | 'minimal' | 'modern' | 'invoice',
  { label: string; hint: string; build: () => ReceiptElement[] }
> = {
  classic: {
    label: 'Classic',
    hint: 'Logo, shop details, items, totals, barcode and a thank-you note',
    build: () => [
      { id: newElementId(), type: 'logo' },
      text('{shop_name}', { bold: true }),
      text('{shop_address}'),
      text('Tel: {shop_phone}'),
      line(),
      text('Bill: {bill_no}', { align: 'left' }),
      text('Date: {date}', { align: 'left' }),
      text('Cashier: {cashier}', { align: 'left' }),
      text('Customer: {customer} {customer_phone}', { align: 'left' }),
      line(),
      items(),
      line(),
      { id: newElementId(), type: 'totals' },
      { id: newElementId(), type: 'payments' },
      line(),
      { id: newElementId(), type: 'itemCount' },
      { id: newElementId(), type: 'savings' },
      { id: newElementId(), type: 'barcode' },
      text('Thank you! Please come again.', { bold: true }),
      text('Goods once sold can be exchanged within 7 days with the bill.'),
    ],
  },
  compact: {
    label: 'Compact',
    hint: 'Short and paper-saving, one line per item',
    build: () => [
      text('{shop_name}', { bold: true, size: 'large' }),
      text('Tel: {shop_phone}'),
      line(),
      text('{bill_no}  {date}', { align: 'left' }),
      line(),
      items('one-line'),
      line(),
      { id: newElementId(), type: 'totals' },
      { id: newElementId(), type: 'payments' },
      line(),
      text('Thank you!', { bold: true }),
    ],
  },
  minimal: {
    label: 'Minimal',
    hint: 'Only the shop name, items and the total',
    build: () => [
      text('{shop_name}', { bold: true }),
      text('{date}'),
      line(),
      items('one-line'),
      line(),
      { id: newElementId(), type: 'totals' },
    ],
  },
  modern: {
    label: 'Modern',
    hint: 'Big shop name, two-column details, a highlighted total and a WhatsApp QR',
    build: () => [
      { id: newElementId(), type: 'logo' },
      text('{shop_name}', { bold: true, size: 'large' }),
      text('{shop_address}'),
      text('{shop_phone}'),
      line('dotted'),
      pair('Bill {bill_no}', '{day}'),
      pair('Cashier: {cashier}', '{time}'),
      text('Customer: {customer} {customer_phone}', { align: 'left', when: 'customer' }),
      line('dotted'),
      { ...items(), numbered: true },
      line('dotted'),
      { id: newElementId(), type: 'totals' },
      { id: newElementId(), type: 'payments' },
      { id: newElementId(), type: 'savings' },
      line('dotted'),
      text(' THANK YOU ', { bold: true, invert: true }),
      { id: newElementId(), type: 'qr', value: 'https://wa.me/94771234567', size: 'small' },
      text('Chat with us on WhatsApp'),
      { id: newElementId(), type: 'barcode' },
    ],
  },
  invoice: {
    label: 'Tax invoice',
    hint: 'For VAT-registered and wholesale shops: VAT number, customer and signature',
    build: () => [
      { id: newElementId(), type: 'logo' },
      text('{shop_name}', { bold: true, size: 'tall' }),
      text('{shop_address}'),
      text('Tel: {shop_phone}  {shop_email}'),
      text('VAT No: {vat_no}'),
      line('double'),
      text('TAX INVOICE', { bold: true, size: 'wide' }),
      line('double'),
      pair('Invoice: {bill_no}', '{date}'),
      pair('Customer: {customer}', '{customer_phone}'),
      text('Cashier: {cashier} ({price_mode})', { align: 'left' }),
      line(),
      { ...items(), showSku: true, numbered: true },
      line(),
      { id: newElementId(), type: 'totals' },
      { id: newElementId(), type: 'payments' },
      line(),
      text('Note: {note}', { align: 'left' }),
      text('Please pay within 30 days.', { when: 'credit' }),
      { id: newElementId(), type: 'signature', label: 'Received by', when: 'credit' },
      { id: newElementId(), type: 'barcode' },
      text('Thank you for your business!', { bold: true }),
    ],
  },
};

/** The design shops get before they change anything. */
export const defaultReceiptLayout = () => RECEIPT_TEMPLATES.classic.build();

/** Older versions saved switches and texts instead of a design; turn them into the same receipt. */
export function receiptLayoutFromLegacy(old: Record<string, unknown>): ReceiptElement[] {
  const s = (k: string) => (typeof old[k] === 'string' ? (old[k] as string) : '');
  const b = (k: string, dflt: boolean) =>
    typeof old[k] === 'boolean' ? (old[k] as boolean) : dflt;
  const out: ReceiptElement[] = [];
  if (b('showLogo', true)) out.push({ id: newElementId(), type: 'logo' });
  if (b('showShopName', true)) out.push(text('{shop_name}', { bold: true }));
  if (b('showAddress', true)) out.push(text('{shop_address}'));
  if (b('showPhone', true)) out.push(text('Tel: {shop_phone}'));
  if (b('showEmail', false)) out.push(text('{shop_email}'));
  for (const part of s('headerText').split('\n').filter(Boolean)) out.push(text(part));
  if (s('title')) out.push(text(s('title').toUpperCase(), { bold: true, size: 'large' }));
  out.push(line());
  out.push(text('Bill: {bill_no}', { align: 'left' }), text('Date: {date}', { align: 'left' }));
  if (b('showCashier', true)) out.push(text('Cashier: {cashier}', { align: 'left' }));
  if (b('showCustomer', true))
    out.push(text('Customer: {customer} {customer_phone}', { align: 'left' }));
  out.push(line());
  out.push({
    id: newElementId(),
    type: 'items',
    layout: old.itemLayout === 'one-line' ? 'one-line' : 'two-line',
    showSku: b('showSku', false),
    showDiscounts: b('showItemDiscounts', true),
    showWarranty: b('showWarranty', true),
    showSerial: b('showSerial', true),
  });
  out.push(
    line(),
    { id: newElementId(), type: 'totals' },
    { id: newElementId(), type: 'payments' },
    line(),
  );
  if (b('showItemCount', true)) out.push({ id: newElementId(), type: 'itemCount' });
  if (b('showSavings', true)) out.push({ id: newElementId(), type: 'savings' });
  if (b('showBarcode', true)) out.push({ id: newElementId(), type: 'barcode' });
  const footer = s('footerText');
  const thanks = s('thankYou');
  if (thanks && !footer.toLowerCase().includes(thanks.toLowerCase()))
    out.push(text(thanks, { bold: true }));
  for (const part of footer.split('\n').filter(Boolean)) out.push(text(part));
  if (s('qrText')) out.push({ id: newElementId(), type: 'qr', value: s('qrText') });
  if (s('qrLabel')) out.push(text(s('qrLabel')));
  return out;
}

/** Does the design print the logo? (The printer settings then prepare the logo image.) */
export const receiptHasLogo = (layout: readonly ReceiptElement[]) =>
  layout.some((e) => e.type === 'logo');
