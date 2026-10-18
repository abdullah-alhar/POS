import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, warrantyEnd, warrantyLabel, type ReceiptDoc } from '@shoppos/shared';
import { encodeReceipt, renderText } from '../src/modules/printing/escpos';
import { buildSaleReceipt, sampleSale } from '../src/modules/printing/receipt-builder';
import { SettingsService } from '../src/modules/settings/settings.service';
import { resetDb, standardUsers, startApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await resetDb(ctx);
});

async function shop() {
  const users = await standardUsers(ctx);
  const watch = (
    await users.adminHttp
      .post('/api/products')
      .send({
        name: 'Smart Watch',
        warrantyDays: 365,
        trackSerial: true,
        variants: [
          { retailPrice: 1_000_000, wholesalePrice: 900_000, costPrice: 700_000, openingStock: 10 },
        ],
      })
      .expect(201)
  ).body;
  await users.adminHttp.post('/api/cash-sessions/open').send({ openingCash: 0 }).expect(201);
  return { ...users, watch, variantId: watch.variants[0].id as string };
}

type Http = Awaited<ReturnType<typeof shop>>['adminHttp'];
const sellWatch = (http: Http, variantId: string, serialNo: string | null, qty = 1) =>
  http.post('/api/sales').send({
    clientId: randomUUID(),
    priceMode: 'RETAIL',
    lines: [{ variantId, qty, listPrice: 1_000_000, unitPrice: 1_000_000, serialNo }],
    payments: [{ method: 'CASH', amount: qty * 1_000_000 }],
    expectedTotal: qty * 1_000_000,
  });

const text = (doc: ReceiptDoc) => renderText(doc, 48);

describe('warranty and serial numbers', () => {
  it('needs one serial per line, refuses a serial sold before, and stores the warranty', async () => {
    const { adminHttp, watch, variantId } = await shop();
    expect(watch).toMatchObject({ warrantyDays: 365, trackSerial: true });

    await sellWatch(adminHttp, variantId, null).expect(400);
    await sellWatch(adminHttp, variantId, 'SN-1', 2).expect(400);
    const sale = (await sellWatch(adminHttp, variantId, ' 356938035643809 ').expect(201)).body.sale;
    expect(sale.items[0]).toMatchObject({ serialNo: '356938035643809', warrantyDays: 365 });
    await sellWatch(adminHttp, variantId, '356938035643809').expect(409);

    // Found by IMEI in the sales history.
    const found = (await adminHttp.get('/api/sales?q=35693803564').expect(200)).body;
    expect(found.items.map((s: { number: string }) => s.number)).toEqual([sale.number]);

    // The receipt shows the IMEI and the warranty end date.
    const receipt = text((await adminHttp.get(`/api/sales/${sale.id}/receipt`).expect(200)).body);
    expect(receipt).toContain('IMEI/SN: 356938035643809');
    expect(receipt).toMatch(/Warranty: 1 year \(until \d\d\/\d\d\/\d{4}\)/);

    // After a return, the same IMEI can be sold again.
    await adminHttp
      .post('/api/returns')
      .send({
        saleId: sale.id,
        reason: 'Exchange',
        refundMethod: 'CASH',
        items: [{ saleItemId: sale.items[0].id, qty: 1 }],
      })
      .expect(201);
    await sellWatch(adminHttp, variantId, '356938035643809').expect(201);
  });

  it('has warranty labels and end dates people understand', () => {
    expect(warrantyLabel(7)).toBe('7 days');
    expect(warrantyLabel(182)).toBe('6 months');
    expect(warrantyLabel(365)).toBe('1 year');
    expect(warrantyLabel(730)).toBe('2 years');
    const end = warrantyEnd(new Date(2026, 9, 14), 365);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2027, 9, 14]);
  });
});

describe('quotation', () => {
  it('prints the bill as a quotation without saving a sale or moving stock', async () => {
    const { adminHttp, variantId } = await shop();
    const res = await adminHttp
      .post('/api/sales/quote')
      .send({
        priceMode: 'RETAIL',
        lines: [{ variantId, qty: 3, listPrice: 1_000_000, unitPrice: 1_000_000 }],
        validDays: 14,
      })
      .expect(200);
    const out = text(res.body.doc);
    expect(out).toContain('QUOTATION');
    expect(out).toContain('Valid until');
    expect(out).toContain('30,000');
    expect(out).not.toMatch(/^Cash \s/m); // no payment lines on a quotation
    expect(await ctx.prisma.sale.count()).toBe(0);
    expect(
      (await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQty,
    ).toBe(10);
  });
});

describe('receipt designer', () => {
  it('turns an old switch-based receipt setting into a design', async () => {
    await ctx.prisma.setting.upsert({
      where: { key: 'receipt' },
      create: {
        key: 'receipt',
        value: {
          headerText: 'Open 9-9',
          footerText: 'No refunds',
          showLogo: false,
          showBarcode: true,
          language: 'en',
        },
      },
      update: {
        value: {
          headerText: 'Open 9-9',
          footerText: 'No refunds',
          showLogo: false,
          showBarcode: true,
          language: 'en',
        },
      },
    });
    await ctx.app.get(SettingsService).reload();
    const layout = ctx.app.get(SettingsService).get('receipt').layout;
    expect(layout.some((e) => e.type === 'logo')).toBe(false);
    expect(layout.some((e) => e.type === 'barcode')).toBe(true);
    expect(
      layout.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text),
    ).toEqual(expect.arrayContaining(['Open 9-9', 'No refunds', '{shop_name}']));
  });

  it('previews an unsaved design on the latest bill', async () => {
    const { adminHttp, cashierHttp, variantId } = await shop();
    await sellWatch(adminHttp, variantId, 'SN-77').expect(201);
    const receipt = {
      ...DEFAULT_SETTINGS.receipt,
      copies: 2,
      layout: [
        { id: 'a', type: 'text', text: 'TAX INVOICE', align: 'center', bold: true, size: 'large' },
        {
          id: 'b',
          type: 'text',
          text: 'Bill {bill_no}',
          align: 'left',
          bold: false,
          size: 'normal',
        },
        {
          id: 'c',
          type: 'text',
          text: 'Customer: {customer}',
          align: 'left',
          bold: false,
          size: 'normal',
        },
        {
          id: 'd',
          type: 'items',
          layout: 'one-line',
          showSku: false,
          showDiscounts: true,
          showWarranty: true,
          showSerial: true,
        },
        { id: 'e', type: 'totals' },
        { id: 'f', type: 'qr', value: 'https://wa.me/94771234567' },
        {
          id: 'g',
          type: 'text',
          text: 'Chat with us',
          align: 'center',
          bold: false,
          size: 'normal',
        },
      ],
    };
    const res = await adminHttp.post('/api/printing/receipt-preview').send({ receipt }).expect(200);
    const out = text(res.body.doc);
    expect(out).toContain('TAX INVOICE');
    expect(out).not.toContain('Cashier:');
    expect(out).not.toContain('Customer:'); // no customer on the bill: the line is left out
    expect(out).toContain('IMEI/SN: SN-77');
    expect(res.body.pieces.map((p: { id: string }) => p.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
    ]);
    expect(out).toContain('[qr https://wa.me/94771234567]');
    expect(out).toContain('Chat with us');
    expect(out).toContain('*** COPY ***');
    expect(res.body.doc.blocks.filter((b: { type: string }) => b.type === 'cut')).toHaveLength(1);
    // Saved settings are not changed by a preview; cashiers cannot use the designer.
    expect((await adminHttp.get('/api/settings').expect(200)).body.receipt.layout).toHaveLength(
      DEFAULT_SETTINGS.receipt.layout.length,
    );
    await cashierHttp.post('/api/printing/receipt-preview').send({ receipt }).expect(403);
  });

  it('adds a signed shop copy for credit sales and prints savings', () => {
    const sale = sampleSale();
    sale.payments = [{ method: 'CREDIT', amount: sale.total, tendered: null, reference: null }];
    const doc = buildSaleReceipt(sale, DEFAULT_SETTINGS);
    const out = text(doc);
    expect(out).toContain('*** SHOP COPY ***');
    expect(out).toContain('Customer signature');
    expect(out).toContain('You saved Rs 150 today!');
    // A reprint is always one copy.
    expect(
      buildSaleReceipt(sale, DEFAULT_SETTINGS, { copy: true }).blocks.some((b) => b.type === 'cut'),
    ).toBe(false);
  });

  it('encodes a QR code and a cut between copies for the thermal printer', () => {
    const doc: ReceiptDoc = {
      blocks: [
        { type: 'text', text: 'A' },
        { type: 'qr', value: 'hi' },
        { type: 'cut' },
        { type: 'text', text: 'B' },
      ],
    };
    const bytes = encodeReceipt(doc, {
      charsPerLine: 48,
      logo: null,
      autoCut: true,
      feedLines: 3,
      openDrawer: false,
    });
    const hex = bytes.toString('hex');
    expect(hex).toContain('1d286b0500315030' + Buffer.from('hi').toString('hex')); // store QR data
    expect(hex).toContain('1d286b0300315130'); // print QR
    expect(hex.split('1d564200').length - 1).toBe(2); // cut between copies and at the end
  });
});
