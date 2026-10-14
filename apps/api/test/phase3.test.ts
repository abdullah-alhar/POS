import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { averageCost } from '../src/modules/purchases/purchases.service';
import { refundShare } from '../src/modules/returns/returns.service';
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
  const make = async (name: string, retail: number, cost: number, stock: number) =>
    (
      await users.adminHttp
        .post('/api/products')
        .send({
          name,
          variants: [
            {
              retailPrice: retail,
              wholesalePrice: retail,
              costPrice: cost,
              openingStock: stock,
              reorderLevel: 2,
            },
          ],
        })
        .expect(201)
    ).body.variants[0];
  const charger = await make('Charger', 450_000, 280_000, 10);
  const cable = await make('Cable', 100_000, 40_000, 5);
  await users.adminHttp.post('/api/cash-sessions/open').send({ openingCash: 0 }).expect(201);
  return { ...users, charger, cable };
}

const stockOf = async (id: string) =>
  (await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockQty;

describe('helpers', () => {
  it('works out the weighted average cost', () => {
    expect(averageCost(10, 280_000, 10, 300_000)).toBe(290_000);
    expect(averageCost(-3, 280_000, 5, 300_000)).toBe(300_000); // negative stock counts as zero
    expect(averageCost(0, 0, 4, 125_000)).toBe(125_000);
  });
  it('splits refunds so every return of a line adds up exactly', () => {
    // 3 items for Rs 100.00 in total (after a bill discount): 33.33 + 33.34 + 33.33
    const parts = [
      refundShare(10_000, 3, 0, 1),
      refundShare(10_000, 3, 1, 1),
      refundShare(10_000, 3, 2, 1),
    ];
    expect(parts.reduce((a, b) => a + b)).toBe(10_000);
  });
});

describe('stock adjustments', () => {
  it('sets stock from a count and records a movement', async () => {
    const { adminHttp, charger } = await shop();
    const res = await adminHttp
      .post('/api/stock/adjustments')
      .send({
        reason: 'COUNT_CORRECTION',
        items: [{ variantId: charger.id, mode: 'COUNT', qty: 7 }],
      })
      .expect(201);
    expect(res.body.number).toMatch(/^ADJ-\d{4}-000001$/);
    expect(res.body.items[0].qtyChange).toBe(-3);
    expect(await stockOf(charger.id)).toBe(7);
    const moves = await adminHttp.get(`/api/stock/movements?variantId=${charger.id}`).expect(200);
    expect(moves.body.items[0]).toMatchObject({ type: 'ADJUSTMENT', qtyChange: -3, qtyAfter: 7 });
  });

  it('needs an admin PIN when a cashier adjusts', async () => {
    const { cashierHttp, adminHttp, cashier, charger } = await shop();
    await adminHttp
      .patch(`/api/users/${cashier.id}`)
      .send({ permissions: ['products.view', 'stock.adjust'] })
      .expect(200);
    const res = await cashierHttp
      .post('/api/stock/adjustments')
      .send({ reason: 'DAMAGED', items: [{ variantId: charger.id, mode: 'CHANGE', qty: -1 }] })
      .expect(403);
    expect(res.body.code).toBe('APPROVAL_REQUIRED');
  });

  it('lists low-stock items', async () => {
    const { adminHttp, cable } = await shop();
    await adminHttp
      .post('/api/stock/adjustments')
      .send({ reason: 'LOST', items: [{ variantId: cable.id, mode: 'COUNT', qty: 1 }] })
      .expect(201);
    const low = await adminHttp.get('/api/stock/low-stock').expect(200);
    expect(low.body.map((i: { variantId: string }) => i.variantId)).toContain(cable.id);
  });
});

describe('purchases', () => {
  it('adds stock only when received, and updates the average cost', async () => {
    const { adminHttp, charger } = await shop();
    const supplier = (
      await adminHttp.post('/api/suppliers').send({ name: 'Anker Lanka' }).expect(201)
    ).body;
    const draft = (
      await adminHttp
        .post('/api/purchases')
        .send({
          supplierId: supplier.id,
          invoiceDate: '2026-10-01',
          discount: 100_000,
          items: [{ variantId: charger.id, qty: 10, unitCost: 310_000 }],
        })
        .expect(201)
    ).body;
    expect(draft.status).toBe('DRAFT');
    expect(draft.total).toBe(3_000_000);
    expect(await stockOf(charger.id)).toBe(10);

    await adminHttp.post(`/api/purchases/${draft.id}/receive`).expect(200);
    expect(await stockOf(charger.id)).toBe(20);
    // Paid 3,000,000 for 10 (300,000 each after the discount); had 10 at 280,000 → 290,000
    const v = await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: charger.id } });
    expect(v.costPrice).toBe(290_000);
    await adminHttp.post(`/api/purchases/${draft.id}/receive`).expect(409);

    const suppliers = await adminHttp.get('/api/suppliers').expect(200);
    expect(suppliers.body[0].balance).toBe(3_000_000);
    await adminHttp
      .post(`/api/suppliers/${supplier.id}/payments`)
      .send({ amount: 1_000_000, method: 'BANK_TRANSFER', purchaseId: draft.id })
      .expect(201);
    expect((await adminHttp.get('/api/suppliers').expect(200)).body[0].balance).toBe(2_000_000);
  });

  it('cannot change a received purchase', async () => {
    const { adminHttp, charger } = await shop();
    const supplier = (await adminHttp.post('/api/suppliers').send({ name: 'S' }).expect(201)).body;
    const body = {
      supplierId: supplier.id,
      invoiceDate: '2026-10-01',
      items: [{ variantId: charger.id, qty: 1, unitCost: 1 }],
    };
    const p = (await adminHttp.post('/api/purchases').send(body).expect(201)).body;
    await adminHttp.post(`/api/purchases/${p.id}/receive`).expect(200);
    await adminHttp.put(`/api/purchases/${p.id}`).send(body).expect(409);
    await adminHttp.post(`/api/purchases/${p.id}/cancel`).expect(409);
  });
});

describe('returns', () => {
  async function sold(
    http: Awaited<ReturnType<typeof shop>>['adminHttp'],
    charger: { id: string },
    cable: { id: string },
  ) {
    return (
      await http
        .post('/api/sales')
        .send({
          clientId: randomUUID(),
          priceMode: 'RETAIL',
          lines: [
            { variantId: charger.id, qty: 2, listPrice: 450_000, unitPrice: 450_000 },
            { variantId: cable.id, qty: 1, listPrice: 100_000, unitPrice: 100_000 },
          ],
          billDiscount: { type: 'AMOUNT', value: 100_000 },
          payments: [{ method: 'CASH', amount: 900_000 }],
          expectedTotal: 900_000,
        })
        .expect(201)
    ).body.sale;
  }

  it('refunds the share actually paid and puts items back in stock', async () => {
    const { adminHttp, charger, cable } = await shop();
    const sale = await sold(adminHttp, charger, cable);
    const returnable = (await adminHttp.get(`/api/sales/${sale.number}/returnable`).expect(200))
      .body;
    const chargerLine = returnable.items.find(
      (i: { variantId: string }) => i.variantId === charger.id,
    );
    const cableLine = returnable.items.find((i: { variantId: string }) => i.variantId === cable.id);

    const ret = (
      await adminHttp
        .post('/api/returns')
        .send({
          saleId: sale.id,
          reason: 'Not working',
          refundMethod: 'CASH',
          items: [
            { saleItemId: chargerLine.saleItemId, qty: 1, restock: true },
            { saleItemId: cableLine.saleItemId, qty: 1, restock: false },
          ],
        })
        .expect(201)
    ).body;
    expect(ret.number).toMatch(/^RET-\d{4}-000001$/);
    // Bill discount of 1,000 shared 900:100 → charger line 810,000 (405,000 each), cable 90,000
    expect(ret.total).toBe(405_000 + 90_000);
    expect(await stockOf(charger.id)).toBe(9); // 10 − 2 sold + 1 back
    expect(await stockOf(cable.id)).toBe(4); // damaged: not restocked

    const again = (await adminHttp.get(`/api/sales/${sale.id}/returnable`).expect(200)).body;
    expect(
      again.items.find((i: { variantId: string }) => i.variantId === charger.id).returnableQty,
    ).toBe(1);
    await adminHttp
      .post('/api/returns')
      .send({
        saleId: sale.id,
        reason: 'again',
        refundMethod: 'CASH',
        items: [{ saleItemId: cableLine.saleItemId, qty: 1 }],
      })
      .expect(400);

    const doc = (await adminHttp.get(`/api/returns/${ret.id}/receipt`).expect(200)).body;
    expect(doc.blocks).toContainEqual(expect.objectContaining({ left: 'REFUND' }));
  });

  it('needs an admin PIN for a cashier refund, and a customer for account refunds', async () => {
    const { adminHttp, cashierHttp, charger, cable } = await shop();
    const sale = await sold(adminHttp, charger, cable);
    const line = (await adminHttp.get(`/api/sales/${sale.id}/returnable`).expect(200)).body
      .items[0];
    const body = {
      saleId: sale.id,
      reason: 'Faulty',
      refundMethod: 'CASH',
      items: [{ saleItemId: line.saleItemId, qty: 1 }],
    };
    expect((await cashierHttp.post('/api/returns').send(body).expect(403)).body.code).toBe(
      'APPROVAL_REQUIRED',
    );
    await adminHttp
      .post('/api/returns')
      .send({ ...body, refundMethod: 'ACCOUNT' })
      .expect(400);
  });
});

describe('product import', () => {
  it('checks first, then creates products, variants and updates prices', async () => {
    const { adminHttp, charger } = await shop();
    const chargerSku = (
      await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: charger.id } })
    ).sku;
    const rows = [
      {
        name: 'Silicone Case',
        variant: 'iPhone 15',
        category: 'Cases',
        brand: 'Generic',
        retailPrice: '1,500',
        costPrice: '600',
        stock: '12',
        barcode: 'CASE15',
      },
      {
        name: 'Silicone Case',
        variant: 'iPhone 16',
        category: 'Cases',
        brand: 'Generic',
        retailPrice: 'Rs 1,600',
        stock: '8',
      },
      { sku: chargerSku, retailPrice: '4200' },
      { name: 'Broken row', retailPrice: 'abc' },
    ];
    const check = (
      await adminHttp.post('/api/products/import').send({ rows, commit: false }).expect(200)
    ).body;
    expect(check.summary).toEqual({ create: 2, addVariant: 0, update: 1, error: 1 });
    expect(check.rows[3].message).toMatch(/not a valid amount/);
    await adminHttp.post('/api/products/import').send({ rows, commit: true }).expect(400);

    const ok = (
      await adminHttp
        .post('/api/products/import')
        .send({ rows: rows.slice(0, 3), commit: true })
        .expect(200)
    ).body;
    expect(ok.committed).toBe(true);
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { name: 'Silicone Case' },
      include: { variants: true, category: true },
    });
    expect(product.variants).toHaveLength(2);
    expect(product.category?.name).toBe('Cases');
    const v15 = product.variants.find((v) => v.name === 'iPhone 15')!;
    expect(v15).toMatchObject({
      retailPrice: 150_000,
      costPrice: 60_000,
      stockQty: 12,
      wholesalePrice: 150_000,
    });
    expect(
      (await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: charger.id } }))
        .retailPrice,
    ).toBe(420_000);

    // Same file again: the barcode now matches, so nothing new is created.
    const again = (
      await adminHttp
        .post('/api/products/import')
        .send({ rows: rows.slice(0, 1), commit: false })
        .expect(200)
    ).body;
    expect(again.summary.update).toBe(1);
  });
});
