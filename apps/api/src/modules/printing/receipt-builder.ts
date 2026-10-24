import {
  bpToPercentText,
  formatMoney,
  PAYMENT_METHOD_LABELS,
  REFUND_METHOD_LABELS,
  type AllSettings,
  type ReceiptBlock,
  type CashSessionSummary,
  type ReceiptDoc,
  type SaleDto,
  type SaleReturnDto,
  warrantyEnd,
  warrantyLabel,
  type ReceiptCondition,
  type ReceiptField,
} from '@shoppos/shared';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** 13/10/2026 14:05 in the shop's (server's) time zone. */
export function receiptDate(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export interface SaleReceiptOptions {
  /** Reprint: one copy, marked REPRINT. */
  copy?: boolean;
  /** Print as a quotation (price offer) valid until this date: no payments, no bill number. */
  quoteValidUntil?: Date;
}

/** Why a piece is not printed on this bill (the editor shows it faded with the reason). */
export type SkippedReason = 'hidden' | 'condition';

export interface DesignPiece {
  id: string;
  blocks: ReceiptBlock[];
  skipped?: SkippedReason;
}

/**
 * The customer receipt for a bill, as printer-independent blocks. What is shown follows the
 * receipt design in Settings → Receipt. Several copies are joined with a paper cut between them.
 */
export function buildSaleReceipt(
  sale: SaleDto,
  settings: AllSettings,
  opts: SaleReceiptOptions = {},
): ReceiptDoc {
  const { receipt } = settings;
  const one = (label?: string) => saleReceiptBlocks(sale, settings, opts, label);
  if (opts.copy || opts.quoteValidUntil) return { blocks: one() };

  const copies: ReceiptBlock[][] = [];
  for (let i = 0; i < receipt.copies; i++) copies.push(one(i === 0 ? undefined : 'COPY'));
  const onCredit = sale.payments.some((p) => p.method === 'CREDIT');
  if (onCredit && receipt.shopCopyForCredit) copies.push(one('SHOP COPY'));
  return { blocks: copies.flatMap((c, i) => (i ? [{ type: 'cut' as const }, ...c] : c)) };
}

function saleReceiptBlocks(
  sale: SaleDto,
  settings: AllSettings,
  opts: SaleReceiptOptions,
  copyLabel?: string,
): ReceiptBlock[] {
  return designBlocks(sale, settings, opts, copyLabel)
    .filter((e) => !e.skipped)
    .flatMap((e) => e.blocks);
}

/** Does a "print only when …" condition hold for this bill? */
export function conditionHolds(
  when: ReceiptCondition | undefined,
  sale: SaleDto,
  opts: SaleReceiptOptions,
): boolean {
  const paid = (m: string) => sale.payments.some((p) => p.method === m);
  switch (when ?? 'always') {
    case 'always':
      return true;
    case 'customer':
      return !!sale.customer;
    case 'noCustomer':
      return !sale.customer;
    case 'cash':
      return paid('CASH');
    case 'card':
      return paid('CARD');
    case 'credit':
      return paid('CREDIT');
    case 'discount':
      return sale.itemDiscountTotal + sale.billDiscountAmount > 0;
    case 'warranty':
      return sale.items.some((i) => i.warrantyDays > 0);
    case 'wholesale':
      return sale.priceMode === 'WHOLESALE';
    case 'retail':
      return sale.priceMode === 'RETAIL';
    case 'quote':
      return !!opts.quoteValidUntil;
    case 'notQuote':
      return !opts.quoteValidUntil;
    case 'reprint':
      return !!opts.copy;
  }
}

const DIVIDER_CHARS = { dashed: '-', double: '=', dotted: '.', stars: '*' } as const;

/**
 * The receipt design filled in with one bill, piece by piece. The editor shows each piece on its
 * own (so it can be selected and moved); printing joins them. Hidden pieces and pieces whose
 * "print only when" does not hold for this bill are filled in too but marked `skipped`.
 */
export function designBlocks(
  sale: SaleDto,
  settings: AllSettings,
  opts: SaleReceiptOptions = {},
  copyLabel?: string,
): DesignPiece[] {
  const { shop, receipt, pos, tax } = settings;
  const money = (c: number) => formatMoney(c, { symbol: '', showCents: pos.showCents });
  const signed = (c: number) => `-${money(c)}`;
  const quote = !!opts.quoteValidUntil;
  const fields: Record<ReceiptField, string> = {
    shop_name: shop.name,
    shop_address: shop.address,
    shop_phone: shop.phone,
    shop_email: shop.email,
    vat_no: tax.vatRegistered ? tax.vatNumber : '',
    bill_no: quote ? 'QUOTATION' : sale.number,
    date: receiptDate(sale.createdAt),
    cashier: sale.cashier.fullName,
    customer: sale.customer?.name ?? '',
    customer_phone: sale.customer?.phone ?? '',
    price_mode: sale.priceMode === 'WHOLESALE' ? 'Wholesale' : 'Retail',
    day: receiptDate(sale.createdAt).slice(0, 10),
    time: receiptDate(sale.createdAt).slice(11),
    total: formatMoney(sale.total, { symbol: pos.currencySymbol, showCents: pos.showCents }),
    item_count: String(sale.items.reduce((n, i) => n + i.qty, 0)),
    payment_method: quote
      ? ''
      : [...new Set(sale.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]))].join(' + '),
    note: sale.note ?? '',
  };
  // A text whose fields are all empty (e.g. "Customer: {customer}" with no customer) is left out.
  const fill = (text: string): string | null => {
    let used = 0;
    let filledCount = 0;
    const out = text
      .replace(/\{(\w+)\}/g, (m, key: string) => {
        if (!(key in fields)) return m;
        used++;
        const v = fields[key as ReceiptField];
        if (v) filledCount++;
        return v;
      })
      .replace(/ {2,}/g, ' ');
    return used > 0 && filledCount === 0 ? null : out;
  };

  // Shown above the first piece of the bill, whatever the design.
  const notes: ReceiptBlock[] = [];
  if (quote) {
    notes.push({ type: 'text', text: 'QUOTATION', align: 'center', bold: true, large: true });
    notes.push({
      type: 'text',
      text: `Valid until ${receiptDate(opts.quoteValidUntil!.toISOString()).slice(0, 10)}`,
      align: 'center',
    });
  }
  if (copyLabel)
    notes.push({ type: 'text', text: `*** ${copyLabel} ***`, align: 'center', bold: true });
  if (opts.copy) notes.push({ type: 'text', text: '*** REPRINT ***', align: 'center', bold: true });
  if (sale.status === 'VOIDED')
    notes.push({ type: 'text', text: '*** VOIDED ***', align: 'center', bold: true });

  let savings = sale.billDiscountAmount;
  for (const i of sale.items)
    savings += i.discountAmount + Math.max(0, i.listPrice - i.unitPrice) * i.qty;

  const out: DesignPiece[] = [];
  let notesPlaced = !notes.length;
  for (const el of receipt.layout) {
    const b: ReceiptBlock[] = [];
    switch (el.type) {
      case 'logo':
        b.push({ type: 'logo', ...(el.align && el.align !== 'center' && { align: el.align }) });
        break;
      case 'text': {
        const filled = fill(el.text);
        if (filled === null) break;
        for (const part of filled.split('\n')) {
          b.push({
            type: 'text',
            text: part.trim(),
            align: el.align,
            bold: el.bold,
            ...(el.size === 'large' && { large: true }),
            ...(el.size === 'tall' && { tall: true }),
            ...(el.size === 'wide' && { wide: true }),
            ...(el.underline && { underline: true }),
            ...(el.invert && { invert: true }),
          });
        }
        break;
      }
      case 'pair': {
        const left = fill(el.left);
        const right = fill(el.right);
        if (left === null && right === null) break;
        b.push({
          type: 'row',
          left: (left ?? '').trim(),
          right: (right ?? '').trim(),
          bold: el.bold,
          large: el.size === 'large',
        });
        break;
      }
      case 'signature':
        b.push(
          { type: 'feed', lines: 2 },
          { type: 'text', text: '..............................', align: 'center' },
          { type: 'text', text: el.label, align: 'center' },
        );
        break;
      case 'divider':
        b.push({ type: 'divider', char: DIVIDER_CHARS[el.style] });
        break;
      case 'space':
        b.push({ type: 'feed', lines: el.lines });
        break;
      case 'items':
        sale.items.forEach((item, index) => {
          const name = item.variantName
            ? `${item.productName} - ${item.variantName}`
            : item.productName;
          const num = el.numbered ? `${index + 1}. ` : '';
          const gross = item.unitPrice * item.qty;
          if (el.layout === 'one-line') {
            b.push({
              type: 'row',
              left: `${num}${item.qty > 1 ? `${item.qty} x ` : ''}${name}`,
              right: money(gross),
            });
            if (item.qty > 1) b.push({ type: 'text', text: `   @ ${money(item.unitPrice)}` });
          } else {
            b.push({ type: 'text', text: `${num}${name}` });
            b.push({
              type: 'row',
              left: `  ${item.qty} x ${money(item.unitPrice)}`,
              right: money(gross),
            });
          }
          if (el.showSku) b.push({ type: 'text', text: `  Code: ${item.sku}` });
          if (el.showWarranty && item.warrantyDays > 0) {
            const until = receiptDate(
              warrantyEnd(new Date(sale.createdAt), item.warrantyDays).toISOString(),
            ).slice(0, 10);
            b.push({
              type: 'text',
              text: `  Warranty: ${warrantyLabel(item.warrantyDays)} (until ${until})`,
            });
          }
          if (el.showDiscounts && item.discountAmount > 0) {
            const label =
              item.discountType === 'PERCENT' && item.discountValue
                ? `  Discount ${bpToPercentText(item.discountValue)}%`
                : '  Discount';
            b.push({ type: 'row', left: label, right: signed(item.discountAmount) });
          }
        });
        break;
      case 'totals': {
        const discounts = sale.itemDiscountTotal + sale.billDiscountAmount;
        const full = !el.simple;
        if (full && (discounts > 0 || sale.roundingAdjustment !== 0))
          b.push({ type: 'row', left: 'Subtotal', right: money(sale.subtotal) });
        if (full && sale.itemDiscountTotal > 0)
          b.push({ type: 'row', left: 'Item discounts', right: signed(sale.itemDiscountTotal) });
        if (full && sale.billDiscountAmount > 0) {
          const label =
            sale.billDiscountType === 'PERCENT' && sale.billDiscountValue
              ? `Bill discount ${bpToPercentText(sale.billDiscountValue)}%`
              : 'Bill discount';
          b.push({ type: 'row', left: label, right: signed(sale.billDiscountAmount) });
        }
        if (full && sale.roundingAdjustment !== 0) {
          b.push({
            type: 'row',
            left: 'Rounding',
            right: `${sale.roundingAdjustment > 0 ? '+' : '-'}${formatMoney(Math.abs(sale.roundingAdjustment), { symbol: '', showCents: true })}`,
          });
        }
        b.push({
          type: 'row',
          left: 'TOTAL',
          right: formatMoney(sale.total, { symbol: pos.currencySymbol, showCents: pos.showCents }),
          bold: true,
          large: el.bigTotal ?? true,
        });
        if (full && tax.vatRegistered && tax.showTaxOnReceipt && sale.taxTotal > 0) {
          b.push({
            type: 'row',
            left: tax.pricesIncludeTax ? 'VAT included' : 'VAT',
            right: money(sale.taxTotal),
          });
        }
        break;
      }
      case 'payments':
        if (quote) break;
        for (const p of sale.payments) {
          const label = PAYMENT_METHOD_LABELS[p.method] + (p.reference ? ` (${p.reference})` : '');
          b.push({ type: 'row', left: label, right: money(p.tendered ?? p.amount) });
        }
        if (sale.changeGiven > 0)
          b.push({ type: 'row', left: 'Change', right: money(sale.changeGiven), bold: true });
        break;
      case 'itemCount':
        b.push({ type: 'text', text: `Items: ${sale.items.reduce((n, i) => n + i.qty, 0)}` });
        break;
      case 'savings':
        if (savings > 0 && !quote) {
          b.push({
            type: 'text',
            text: `You saved ${formatMoney(savings, { symbol: pos.currencySymbol, showCents: pos.showCents })} today!`,
            align: 'center',
            bold: true,
          });
        }
        break;
      case 'barcode':
        if (!quote) b.push({ type: 'barcode', value: sale.number });
        break;
      case 'qr':
        if (el.value.trim())
          b.push({ type: 'qr', value: el.value.trim(), ...(el.size && { size: el.size }) });
        break;
    }
    const skipped: SkippedReason | undefined = el.hidden
      ? 'hidden'
      : !conditionHolds(el.when, sale, opts)
        ? 'condition'
        : undefined;
    // Quotation / copy / reprint notes go just before the bill number (or the items).
    if (
      !notesPlaced &&
      !skipped &&
      ((el.type === 'text' && el.text.includes('{bill_no}')) ||
        (el.type === 'pair' && `${el.left}${el.right}`.includes('{bill_no}')) ||
        el.type === 'items')
    ) {
      b.unshift(...notes);
      notesPlaced = true;
    }
    out.push({ id: el.id, blocks: b, ...(skipped && { skipped }) });
  }
  if (!notesPlaced) out.unshift({ id: 'notes', blocks: notes });
  if (copyLabel === 'SHOP COPY') {
    out.push({
      id: 'signature',
      blocks: [
        { type: 'feed', lines: 2 },
        { type: 'text', text: '..............................', align: 'center' },
        { type: 'text', text: 'Customer signature', align: 'center' },
      ],
    });
  }
  return out;
}

/** A realistic bill for the receipt designer's preview when the shop has no sales yet. */
export function sampleSale(): SaleDto {
  const now = new Date().toISOString();
  const item = (
    name: string,
    variant: string,
    qty: number,
    price: number,
    extra: Partial<SaleDto['items'][number]> = {},
  ): SaleDto['items'][number] => ({
    id: name,
    variantId: name,
    productName: name,
    variantName: variant,
    sku: 'P000123',
    qty,
    listPrice: price,
    unitPrice: price,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    billDiscountShare: 0,
    taxRateBp: 0,
    taxAmount: 0,
    lineTotal: price * qty,
    returnedQty: 0,
    warrantyDays: 0,
    ...extra,
  });
  const items = [
    item('Anker 20W USB-C Charger', 'White', 1, 450_000, {
      warrantyDays: 365,
    }),
    item('Tempered Glass', 'iPhone 15', 2, 75_000, {
      discountType: 'PERCENT',
      discountValue: 1000,
      discountAmount: 15_000,
      lineTotal: 135_000,
    }),
    item('USB-C Cable 1m', '', 1, 90_000, { warrantyDays: 182 }),
  ];
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const total = subtotal - 15_000;
  return {
    id: 'sample',
    number: `INV-${new Date().getFullYear()}-000123`,
    clientId: 'sample',
    status: 'COMPLETED',
    priceMode: 'RETAIL',
    createdAt: now,
    cashier: { id: 'x', fullName: 'Shop Owner' },
    customer: { id: 'c', name: 'Nimal Perera', phone: '0771234567' },
    subtotal,
    itemDiscountTotal: 15_000,
    billDiscountType: null,
    billDiscountValue: null,
    billDiscountAmount: 0,
    taxTotal: 0,
    roundingAdjustment: 0,
    total,
    paidTotal: total,
    changeGiven: 1_000_000 - total,
    note: null,
    items,
    payments: [{ method: 'CASH', amount: total, tendered: 1_000_000, reference: null }],
    voidedAt: null,
    voidedBy: null,
    voidApprovedBy: null,
    voidReason: null,
  };
}

/** Printed by "Test print" in Settings. */
export function buildTestReceipt(settings: AllSettings, target: string): ReceiptDoc {
  const { shop, printer } = settings;
  return {
    blocks: [
      { type: 'logo' },
      { type: 'text', text: shop.name, align: 'center', bold: true },
      { type: 'text', text: 'Printer test', align: 'center', large: true },
      { type: 'divider' },
      { type: 'row', left: 'Printer', right: target },
      { type: 'row', left: 'Characters per line', right: String(printer.charsPerLine) },
      { type: 'row', left: 'Printed at', right: receiptDate(new Date().toISOString()) },
      { type: 'divider', char: '=' },
      {
        type: 'text',
        text: '0123456789012345678901234567890123456789012345678'.slice(0, printer.charsPerLine),
      },
      { type: 'row', left: 'Left', right: 'Right' },
      { type: 'row', left: 'TOTAL', right: 'Rs 12,345', bold: true, large: true },
      { type: 'barcode', value: 'INV-2026-000001' },
      { type: 'text', text: 'If this looks right, the printer is ready.', align: 'center' },
    ],
  };
}

/** Slip for a customer return / refund. */
export function buildReturnReceipt(
  ret: SaleReturnDto,
  settings: AllSettings,
  opts: { copy?: boolean } = {},
): ReceiptDoc {
  const { shop, pos } = settings;
  const money = (c: number) => formatMoney(c, { symbol: '', showCents: pos.showCents });
  const b: ReceiptBlock[] = [
    { type: 'text', text: shop.name, align: 'center', bold: true },
    { type: 'text', text: 'RETURN / REFUND', align: 'center', bold: true, large: true },
  ];
  if (opts.copy) b.push({ type: 'text', text: '*** REPRINT ***', align: 'center', bold: true });
  b.push({ type: 'divider' });
  b.push({ type: 'row', left: `Return: ${ret.number}`, right: receiptDate(ret.createdAt) });
  b.push({ type: 'row', left: `Bill: ${ret.sale.number}`, right: ret.user.fullName });
  b.push({ type: 'divider' });
  for (const item of ret.items) {
    b.push({ type: 'text', text: item.name });
    b.push({
      type: 'row',
      left: `  ${item.qty} returned${item.restock ? '' : ' (damaged)'}`,
      right: money(item.refundAmount),
    });
  }
  b.push({ type: 'divider' });
  b.push({
    type: 'row',
    left: 'REFUND',
    right: formatMoney(ret.total, { symbol: pos.currencySymbol, showCents: pos.showCents }),
    bold: true,
    large: true,
  });
  b.push({
    type: 'row',
    left: 'Refunded by',
    right:
      REFUND_METHOD_LABELS[ret.refundMethod as keyof typeof REFUND_METHOD_LABELS] ??
      ret.refundMethod,
  });
  b.push({ type: 'text', text: `Reason: ${ret.reason}` });
  b.push({ type: 'feed', lines: 1 });
  b.push({ type: 'text', text: 'Customer signature: ____________________' });
  return { blocks: b };
}

/** End-of-day (Z) report for a cash session. */
export function buildDayReport(d: CashSessionSummary, settings: AllSettings): ReceiptDoc {
  const { shop, pos } = settings;
  const m = (c: number) => formatMoney(c, { symbol: '', showCents: pos.showCents });
  const b: ReceiptBlock[] = [
    { type: 'text', text: shop.name, align: 'center', bold: true },
    {
      type: 'text',
      text: d.status === 'CLOSED' ? 'END OF DAY REPORT' : 'DAY REPORT (still open)',
      align: 'center',
      bold: true,
    },
    { type: 'divider' },
    { type: 'row', left: 'Opened', right: `${receiptDate(d.openedAt)} ${d.openedBy.fullName}` },
  ];
  if (d.closedAt)
    b.push({
      type: 'row',
      left: 'Closed',
      right: `${receiptDate(d.closedAt)} ${d.closedBy?.fullName ?? ''}`,
    });
  b.push(
    { type: 'divider' },
    { type: 'row', left: `Sales (${d.billCount} bills)`, right: m(d.totalSales), bold: true },
    { type: 'row', left: '  Cash', right: m(d.cashSales) },
    { type: 'row', left: '  Card', right: m(d.cardSales) },
    { type: 'row', left: '  Bank transfer', right: m(d.bankSales) },
    { type: 'row', left: '  Credit (on account)', right: m(d.creditSales) },
    { type: 'row', left: `Voided bills`, right: String(d.voidCount) },
    {
      type: 'row',
      left: `Returns (${d.returnCount})`,
      right: `-${m(d.cashRefunds + d.otherRefunds)}`,
    },
    { type: 'divider' },
    { type: 'text', text: 'CASH DRAWER', bold: true },
    { type: 'row', left: 'Opening cash', right: m(d.openingCash) },
    { type: 'row', left: '+ Cash sales', right: m(d.cashSales) },
    { type: 'row', left: '+ Customer payments', right: m(d.customerCashPayments) },
    { type: 'row', left: '+ Cash in', right: m(d.cashIn) },
    { type: 'row', left: '- Cash out', right: m(d.cashOut) },
    { type: 'row', left: '- Cash refunds', right: m(d.cashRefunds) },
    { type: 'row', left: '- Expenses from drawer', right: m(d.drawerExpenses) },
    { type: 'row', left: 'Expected cash', right: m(d.expectedCash), bold: true },
  );
  if (d.countedCash !== null) {
    b.push({ type: 'row', left: 'Counted cash', right: m(d.countedCash), bold: true });
    const diff = d.difference ?? 0;
    b.push({
      type: 'row',
      left: diff === 0 ? 'Difference' : diff > 0 ? 'Over' : 'SHORT',
      right: m(diff),
      bold: true,
      large: diff !== 0,
    });
  }
  if (d.denominations) {
    b.push({ type: 'divider' }, { type: 'text', text: 'Notes and coins counted' });
    for (const [value, count] of Object.entries(d.denominations).sort(
      (a, b2) => Number(b2[0]) - Number(a[0]),
    )) {
      if (count)
        b.push({
          type: 'row',
          left: `  ${value} x ${count}`,
          right: m(Number(value) * 100 * count),
        });
    }
  }
  if (d.movements.length) {
    b.push({ type: 'divider' }, { type: 'text', text: 'Cash in / out' });
    for (const mv of d.movements) {
      b.push({
        type: 'row',
        left: `  ${mv.type === 'CASH_IN' ? 'In' : 'Out'}: ${mv.reason}`,
        right: m(mv.amount),
      });
    }
  }
  if (d.note) b.push({ type: 'divider' }, { type: 'text', text: `Note: ${d.note}` });
  b.push({ type: 'feed', lines: 1 }, { type: 'text', text: 'Signature: ____________________' });
  return { blocks: b };
}
