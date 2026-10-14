import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutInput } from '@marina/shared';
import { createUser, loginAs, resetDb, standardUsers, startApp, type TestContext } from './helpers';

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

/** Two products, an open day, and logged-in admin + cashier. */
async function shop() {
  const users = await standardUsers(ctx);
  const charger = (
    await users.adminHttp
      .post('/api/products')
      .send({
        name: 'Anker 20W Charger',
        variants: [
          { retailPrice: 450_000, wholesalePrice: 380_000, costPrice: 280_000, openingStock: 10 },
        ],
      })
      .expect(201)
  ).body.variants[0];
  const glass = (
    await users.adminHttp
      .post('/api/products')
      .send({
        name: 'Tempered Glass',
        variants: [
          { retailPrice: 60_000, wholesalePrice: 40_000, costPrice: 15_000, openingStock: 1 },
        ],
      })
      .expect(201)
  ).body.variants[0];
  await users.adminHttp.post('/api/cash-sessions/open').send({ openingCash: 500_000 }).expect(201);
  return { ...users, charger, glass };
}

function bill(
  lines: CheckoutInput['lines'],
  total: number,
  payments?: CheckoutInput['payments'],
): CheckoutInput {
  return {
    clientId: randomUUID(),
    priceMode: 'RETAIL',
    lines,
    payments: payments ?? [{ method: 'CASH', amount: total }],
    expectedTotal: total,
  };
}

describe('checkout', () => {
  it('saves the bill, payments and stock together', async () => {
    const { cashierHttp, charger, glass } = await shop();
    const res = await cashierHttp
      .post('/api/sales')
      .send(
        bill(
          [
            { variantId: charger.id, qty: 2, listPrice: 450_000, unitPrice: 450_000 },
            { variantId: glass.id, qty: 1, listPrice: 60_000, unitPrice: 60_000 },
          ],
          960_000,
          [{ method: 'CASH', amount: 1_000_000 }],
        ),
      )
      .expect(201);

    const { sale, warnings, duplicate } = res.body;
    expect(duplicate).toBe(false);
    expect(warnings).toEqual([]);
    expect(sale.number).toMatch(/^INV-\d{4}-000001$/);
    expect(sale.total).toBe(960_000);
    expect(sale.changeGiven).toBe(40_000);
    expect(sale.payments).toEqual([
      { method: 'CASH', amount: 960_000, tendered: 1_000_000, reference: null },
    ]);
    expect(sale.items.map((i: { productName: string }) => i.productName)).toEqual([
      'Anker 20W Charger',
      'Tempered Glass',
    ]);

    const stock = await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: charger.id } });
    expect(stock.stockQty).toBe(8);
    const moves = await ctx.prisma.stockMovement.findMany({ where: { type: 'SALE' } });
    expect(moves.map((m) => m.qtyChange).sort()).toEqual([-1, -2]);
    const saved = await ctx.prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(saved.costTotal).toBe(2 * 280_000 + 15_000);
  });

  it('gives sequential bill numbers', async () => {
    const { cashierHttp, charger } = await shop();
    const line = [{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }];
    const a = await cashierHttp.post('/api/sales').send(bill(line, 450_000)).expect(201);
    const b = await cashierHttp.post('/api/sales').send(bill(line, 450_000)).expect(201);
    expect(a.body.sale.number.slice(-6)).toBe('000001');
    expect(b.body.sale.number.slice(-6)).toBe('000002');
  });

  it('never saves the same bill twice', async () => {
    const { cashierHttp, charger } = await shop();
    const body = bill(
      [{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }],
      450_000,
    );
    const [a, b] = await Promise.all([
      cashierHttp.post('/api/sales').send(body),
      cashierHttp.post('/api/sales').send(body),
    ]);
    expect(a.body.sale.id).toBe(b.body.sale.id);
    expect([a.body.duplicate, b.body.duplicate].sort()).toEqual([false, true]);
    expect(await ctx.prisma.sale.count()).toBe(1);
    expect(
      (await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: charger.id } })).stockQty,
    ).toBe(9);
  });

  it('asks to open the day first', async () => {
    const users = await standardUsers(ctx);
    const v = (
      await users.adminHttp
        .post('/api/products')
        .send({ name: 'X', variants: [{ retailPrice: 100, wholesalePrice: 100, costPrice: 1 }] })
        .expect(201)
    ).body.variants[0];
    const res = await users.cashierHttp
      .post('/api/sales')
      .send(bill([{ variantId: v.id, qty: 1, listPrice: 100, unitPrice: 100 }], 100))
      .expect(409);
    expect(res.body.code).toBe('DAY_NOT_OPEN');
  });

  it('rejects a bill that is not fully paid, and saves nothing', async () => {
    const { cashierHttp, charger } = await shop();
    const res = await cashierHttp
      .post('/api/sales')
      .send(
        bill([{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }], 450_000, [
          { method: 'CARD', amount: 400_000 },
        ]),
      )
      .expect(400);
    expect(res.body.message).toMatch(/Still to pay/);
    expect(await ctx.prisma.sale.count()).toBe(0);
  });

  it('tells the till when prices changed', async () => {
    const { cashierHttp, adminHttp, charger } = await shop();
    await adminHttp
      .patch(`/api/variants/${charger.id}/prices`)
      .send({ retailPrice: 420_000 })
      .expect(200);
    const res = await cashierHttp
      .post('/api/sales')
      .send(
        bill([{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }], 450_000),
      )
      .expect(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(res.body.details.prices[0].retailPrice).toBe(420_000);
  });

  it('rejects a total that does not match the server calculation', async () => {
    const { cashierHttp, charger } = await shop();
    const res = await cashierHttp
      .post('/api/sales')
      .send(
        bill([{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }], 440_000),
      )
      .expect(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
  });

  it('sells with no stock when allowed, warns and writes the audit log', async () => {
    const { cashierHttp, glass } = await shop();
    const res = await cashierHttp
      .post('/api/sales')
      .send(bill([{ variantId: glass.id, qty: 3, listPrice: 60_000, unitPrice: 60_000 }], 180_000))
      .expect(201);
    expect(res.body.warnings[0]).toMatch(/no stock left \(stock is now -2\)/);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SALE_NO_STOCK' } })).toBe(1);
  });

  it('refuses to sell without stock when the setting is off, and rolls everything back', async () => {
    const { cashierHttp, adminHttp, glass, charger } = await shop();
    const pos = (await adminHttp.get('/api/settings').expect(200)).body.pos;
    await adminHttp
      .put('/api/settings/pos')
      .send({ ...pos, allowZeroStockSale: false })
      .expect(200);
    const res = await cashierHttp
      .post('/api/sales')
      .send(
        bill(
          [
            { variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 },
            { variantId: glass.id, qty: 2, listPrice: 60_000, unitPrice: 60_000 },
          ],
          570_000,
        ),
      )
      .expect(409);
    expect(res.body.message).toMatch(/only 1 left/);
    expect(await ctx.prisma.sale.count()).toBe(0);
    expect(
      (await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: charger.id } })).stockQty,
    ).toBe(10);
    // The failed bill gave its number back.
    const ok = await cashierHttp
      .post('/api/sales')
      .send(
        bill([{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }], 450_000),
      )
      .expect(201);
    expect(ok.body.sale.number.slice(-6)).toBe('000001');
  });

  it('needs admin approval for a price override and a big discount, both at once', async () => {
    const { cashierHttp, admin, charger } = await shop();
    const body = bill(
      [
        {
          variantId: charger.id,
          qty: 1,
          listPrice: 450_000,
          unitPrice: 400_000,
          discount: { type: 'PERCENT', value: 2000 },
        },
      ],
      320_000,
    );
    const first = await cashierHttp.post('/api/sales').send(body).expect(403);
    expect(first.body.details.action).toBe('PRICE_CHANGE');

    const t1 = (
      await cashierHttp
        .post('/api/auth/approve')
        .send({ action: 'PRICE_CHANGE', pin: '9999' })
        .expect(200)
    ).body.token;
    const second = await cashierHttp
      .post('/api/sales')
      .set('x-approval-token', t1)
      .send(body)
      .expect(403);
    expect(second.body.details.action).toBe('LARGE_DISCOUNT');

    const t2 = (
      await cashierHttp
        .post('/api/auth/approve')
        .send({ action: 'LARGE_DISCOUNT', pin: '9999' })
        .expect(200)
    ).body.token;
    const done = await cashierHttp
      .post('/api/sales')
      .set('x-approval-token', `${t1},${t2}`)
      .send(body)
      .expect(201);

    const saved = await ctx.prisma.sale.findUniqueOrThrow({
      where: { id: done.body.sale.id },
      include: { items: true },
    });
    expect(saved.discountApprovedById).toBe(admin.id);
    expect(saved.items[0]!.priceApprovedById).toBe(admin.id);
    expect(saved.total).toBe(320_000);
  });

  it('lets an admin override prices without a PIN', async () => {
    const { adminHttp, charger } = await shop();
    await adminHttp
      .post('/api/sales')
      .send(
        bill([{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 300_000 }], 300_000),
      )
      .expect(201);
  });

  it('splits a payment between card and cash', async () => {
    const { cashierHttp, charger } = await shop();
    const res = await cashierHttp
      .post('/api/sales')
      .send(
        bill([{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }], 450_000, [
          { method: 'CARD', amount: 300_000, reference: '4421' },
          { method: 'CASH', amount: 200_000 },
        ]),
      )
      .expect(201);
    expect(res.body.sale.payments).toEqual([
      { method: 'CARD', amount: 300_000, tendered: null, reference: '4421' },
      { method: 'CASH', amount: 150_000, tendered: 200_000, reference: null },
    ]);
    expect(res.body.sale.changeGiven).toBe(50_000);
  });

  it('uses wholesale prices in wholesale mode', async () => {
    const { cashierHttp, charger } = await shop();
    const body = bill(
      [{ variantId: charger.id, qty: 5, listPrice: 380_000, unitPrice: 380_000 }],
      1_900_000,
    );
    body.priceMode = 'WHOLESALE';
    const res = await cashierHttp.post('/api/sales').send(body).expect(201);
    expect(res.body.sale.priceMode).toBe('WHOLESALE');
  });
});

describe('void', () => {
  it('puts the items back in stock and needs an admin PIN for a cashier', async () => {
    const { cashierHttp, admin, charger } = await shop();
    const sale = (
      await cashierHttp
        .post('/api/sales')
        .send(
          bill(
            [{ variantId: charger.id, qty: 3, listPrice: 450_000, unitPrice: 450_000 }],
            1_350_000,
          ),
        )
        .expect(201)
    ).body.sale;

    await cashierHttp
      .post(`/api/sales/${sale.id}/void`)
      .send({ reason: 'Customer changed mind' })
      .expect(403);
    const token = (
      await cashierHttp
        .post('/api/auth/approve')
        .send({ action: 'VOID_SALE', pin: '9999' })
        .expect(200)
    ).body.token;
    const voided = await cashierHttp
      .post(`/api/sales/${sale.id}/void`)
      .set('x-approval-token', token)
      .send({ reason: 'Customer changed mind' })
      .expect(200);

    expect(voided.body.status).toBe('VOIDED');
    expect(voided.body.voidApprovedBy.id).toBe(admin.id);
    expect(
      (await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: charger.id } })).stockQty,
    ).toBe(10);
    expect(await ctx.prisma.stockMovement.count({ where: { type: 'SALE_VOID' } })).toBe(1);
  });

  it('cannot void twice, and the bill is never deleted', async () => {
    const { adminHttp, charger } = await shop();
    const sale = (
      await adminHttp
        .post('/api/sales')
        .send(
          bill(
            [{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }],
            450_000,
          ),
        )
        .expect(201)
    ).body.sale;
    await adminHttp.post(`/api/sales/${sale.id}/void`).send({ reason: 'Wrong item' }).expect(200);
    await adminHttp.post(`/api/sales/${sale.id}/void`).send({ reason: 'Wrong item' }).expect(409);
    await expect(ctx.prisma.sale.delete({ where: { id: sale.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });
});

describe('sales list', () => {
  it('shows cashiers only their own bills', async () => {
    const { cashierHttp, adminHttp, charger } = await shop();
    const line = [{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }];
    await adminHttp.post('/api/sales').send(bill(line, 450_000)).expect(201);
    await cashierHttp.post('/api/sales').send(bill(line, 450_000)).expect(201);
    expect((await adminHttp.get('/api/sales').expect(200)).body.total).toBe(2);
    expect((await cashierHttp.get('/api/sales').expect(200)).body.total).toBe(1);
  });

  it('finds a bill by number', async () => {
    const { adminHttp, charger } = await shop();
    const sale = (
      await adminHttp
        .post('/api/sales')
        .send(
          bill(
            [{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }],
            450_000,
          ),
        )
        .expect(201)
    ).body.sale;
    const res = await adminHttp.get(`/api/sales?q=${sale.number.toLowerCase()}`).expect(200);
    expect(res.body.items.map((s: { id: string }) => s.id)).toEqual([sale.id]);
  });
});

describe('held bills', () => {
  it('holds and recalls a bill once', async () => {
    const { cashierHttp, charger } = await shop();
    const cart = {
      priceMode: 'RETAIL',
      lines: [
        { variantId: charger.id, name: 'Anker', qty: 2, listPrice: 450_000, unitPrice: 450_000 },
      ],
    };
    const held = (
      await cashierHttp.post('/api/held-bills').send({ label: 'Blue shirt', cart }).expect(201)
    ).body;
    expect(held.itemCount).toBe(2);
    expect((await cashierHttp.get('/api/held-bills').expect(200)).body).toHaveLength(1);
    const recalled = await cashierHttp.post(`/api/held-bills/${held.id}/recall`).expect(200);
    expect(recalled.body.cart.lines[0].qty).toBe(2);
    await cashierHttp.post(`/api/held-bills/${held.id}/recall`).expect(404);
  });
});

describe('receipts', () => {
  it('builds the receipt and prints to a file in test mode', async () => {
    const { adminHttp, charger } = await shop();
    const sale = (
      await adminHttp
        .post('/api/sales')
        .send(
          bill(
            [{ variantId: charger.id, qty: 1, listPrice: 450_000, unitPrice: 450_000 }],
            450_000,
            [{ method: 'CASH', amount: 500_000 }],
          ),
        )
        .expect(201)
    ).body.sale;

    const doc = (await adminHttp.get(`/api/sales/${sale.id}/receipt`).expect(200)).body;
    const rows = doc.blocks.filter((b: { type: string }) => b.type === 'row');
    expect(rows).toContainEqual(expect.objectContaining({ left: 'TOTAL', right: 'Rs 4,500' }));
    expect(rows).toContainEqual(expect.objectContaining({ left: 'Change', right: '500' }));

    const printer = (await adminHttp.get('/api/settings').expect(200)).body.printer;
    await adminHttp
      .put('/api/settings/printer')
      .send({ ...printer, mode: 'file' })
      .expect(200);
    const printed = await adminHttp
      .post(`/api/sales/${sale.id}/print`)
      .send({ copy: true })
      .expect(200);
    expect(printed.body.target).toMatch(/\.txt$/);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SALE_REPRINT' } })).toBe(1);
  });

  it('explains when the Windows printer is not available', async () => {
    const { adminHttp } = await shop();
    const printer = (await adminHttp.get('/api/settings').expect(200)).body.printer;
    await adminHttp
      .put('/api/settings/printer')
      .send({ ...printer, mode: 'windows' })
      .expect(200);
    const res = await adminHttp.post('/api/printing/test').expect(503);
    expect(res.body.code).toBe('PRINTER_ERROR');
  });
});

describe('opening the day', () => {
  it('can only be opened once', async () => {
    await createUser(ctx, { username: 'owner', role: 'ADMIN' });
    const http = await loginAs(ctx, 'owner');
    expect((await http.get('/api/cash-sessions/current').expect(200)).body.session).toBeNull();
    await http.post('/api/cash-sessions/open').send({ openingCash: 100_000 }).expect(201);
    await http.post('/api/cash-sessions/open').send({ openingCash: 100_000 }).expect(409);
    expect(
      (await http.get('/api/cash-sessions/current').expect(200)).body.session.openingCash,
    ).toBe(100_000);
  });
});
