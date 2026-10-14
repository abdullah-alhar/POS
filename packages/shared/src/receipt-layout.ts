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
  cashier: 'Cashier',
  customer: 'Customer name',
  customer_phone: 'Customer phone',
  price_mode: 'Retail / Wholesale',
} as const;
export type ReceiptField = keyof typeof RECEIPT_FIELDS;

const id = z.string().min(1).max(40);
const align = z.enum(['left', 'center', 'right']);

export const receiptElementSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('logo') }),
  z.object({
    id,
    type: z.literal('text'),
    text: z.string().max(500),
    align,
    bold: z.boolean(),
    size: z.enum(['normal', 'large']),
  }),
  z.object({ id, type: z.literal('divider'), style: z.enum(['dashed', 'double']) }),
  z.object({ id, type: z.literal('space'), lines: z.int().min(1).max(5) }),
  z.object({
    id,
    type: z.literal('items'),
    layout: z.enum(['two-line', 'one-line']),
    showSku: z.boolean(),
    showDiscounts: z.boolean(),
    showWarranty: z.boolean(),
    showSerial: z.boolean(),
  }),
  z.object({ id, type: z.literal('totals') }),
  z.object({ id, type: z.literal('payments') }),
  z.object({ id, type: z.literal('itemCount') }),
  z.object({ id, type: z.literal('savings') }),
  z.object({ id, type: z.literal('barcode') }),
  z.object({ id, type: z.literal('qr'), value: z.string().max(300) }),
]);
export type ReceiptElement = z.infer<typeof receiptElementSchema>;
export type ReceiptElementType = ReceiptElement['type'];

/** Names and one-line explanations, for the "Add" panel of the receipt editor. */
export const RECEIPT_ELEMENT_INFO: Record<ReceiptElementType, { label: string; hint: string }> = {
  text: { label: 'Text', hint: 'Any words, with fields like the bill number' },
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
};

let counter = 0;
/** A short unique id for a new piece. */
export function newElementId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const text = (
  t: string,
  opts: Partial<{
    align: 'left' | 'center' | 'right';
    bold: boolean;
    size: 'normal' | 'large';
  }> = {},
) =>
  ({
    id: newElementId(),
    type: 'text',
    text: t,
    align: opts.align ?? 'center',
    bold: opts.bold ?? false,
    size: opts.size ?? 'normal',
  }) as const;
const line = () => ({ id: newElementId(), type: 'divider', style: 'dashed' }) as const;
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
  'classic' | 'compact' | 'minimal',
  { label: string; build: () => ReceiptElement[] }
> = {
  classic: {
    label: 'Classic',
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
    build: () => [
      text('{shop_name}', { bold: true }),
      text('{date}'),
      line(),
      items('one-line'),
      line(),
      { id: newElementId(), type: 'totals' },
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
