import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CASHIER_PERMISSIONS } from '@shoppos/shared';
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
  const item = (
    await users.adminHttp
      .post('/api/products')
      .send({
        name: 'Charger',
        variants: [
          { retailPrice: 100_000, wholesalePrice: 80_000, costPrice: 50_000, openingStock: 50 },
        ],
      })
      .expect(201)
  ).body.variants[0];
  await users.adminHttp.post('/api/cash-sessions/open').send({ openingCash: 500_000 }).expect(201);
  const customer = (
    await users.adminHttp
      .post('/api/customers')
      .send({
        name: 'Kamal Stores',
        phone: '077 123 4567',
        type: 'WHOLESALE',
        creditLimit: 300_000,
      })
      .expect(201)
  ).body;
  return { ...users, item, customer };
}

type Http = Awaited<ReturnType<typeof shop>>['adminHttp'];
const sell = (http: Http, itemId: string, qty: number, payments: object[], customerId?: string) =>
  http.post('/api/sales').send({
    clientId: randomUUID(),
    priceMode: 'RETAIL',
    customerId,
    lines: [{ variantId: itemId, qty, listPrice: 100_000, unitPrice: 100_000 }],
    payments,
    expectedTotal: qty * 100_000,
  });

const balance = async (id: string) =>
  (await ctx.prisma.customer.findUniqueOrThrow({ where: { id } })).balance;

describe('customers and credit', () => {
  it('rejects a second customer with the same phone', async () => {
    const { adminHttp } = await shop();
    await adminHttp.post('/api/customers').send({ name: 'Other', phone: '0771234567' }).expect(409);
    const found = await adminHttp.get('/api/customers?q=0771234567').expect(200);
    expect(found.body.items[0].name).toBe('Kamal Stores');
  });

  it('sells on credit within the limit and records it on the account', async () => {
    const { adminHttp, item, customer } = await shop();
    const res = await sell(
      adminHttp,
      item.id,
      2,
      [{ method: 'CREDIT', amount: 200_000 }],
      customer.id,
    ).expect(201);
    expect(res.body.sale.customer.name).toBe('Kamal Stores');
    expect(await balance(customer.id)).toBe(200_000);
    const ledger = (await adminHttp.get(`/api/customers/${customer.id}/ledger`).expect(200)).body
      .items;
    expect(ledger[0]).toMatchObject({
      type: 'CREDIT_SALE',
      amount: 200_000,
      balanceAfter: 200_000,
    });
  });

  it('needs a customer, the credit permission, and an admin PIN above the limit', async () => {
    const { adminHttp, cashierHttp, cashier, item, customer } = await shop();
    await sell(adminHttp, item.id, 1, [{ method: 'CREDIT', amount: 100_000 }]).expect(400);
    // The default cashier may not sell on credit.
    await sell(
      cashierHttp,
      item.id,
      1,
      [{ method: 'CREDIT', amount: 100_000 }],
      customer.id,
    ).expect(403);

    await adminHttp
      .patch(`/api/users/${cashier.id}`)
      .send({ permissions: [...DEFAULT_CASHIER_PERMISSIONS, 'customers.credit'] })
      .expect(200);
    const over = await sell(
      cashierHttp,
      item.id,
      4,
      [{ method: 'CREDIT', amount: 400_000 }],
      customer.id,
    ).expect(403);
    expect(over.body.details.action).toBe('CREDIT_LIMIT');
    await sell(
      cashierHttp,
      item.id,
      3,
      [{ method: 'CREDIT', amount: 300_000 }],
      customer.id,
    ).expect(201);
  });

  it('takes payments, refunds to the account, and reverses credit when a bill is voided', async () => {
    const { adminHttp, item, customer } = await shop();
    const sale = (
      await sell(
        adminHttp,
        item.id,
        3,
        [{ method: 'CREDIT', amount: 300_000 }],
        customer.id,
      ).expect(201)
    ).body.sale;

    await adminHttp
      .post(`/api/customers/${customer.id}/payments`)
      .send({ amount: 100_000, method: 'CASH' })
      .expect(200);
    expect(await balance(customer.id)).toBe(200_000);
    await adminHttp
      .post(`/api/customers/${customer.id}/payments`)
      .send({ amount: 999_999, method: 'CASH' })
      .expect(400);

    const line = (await adminHttp.get(`/api/sales/${sale.id}/returnable`).expect(200)).body
      .items[0];
    await adminHttp
      .post('/api/returns')
      .send({
        saleId: sale.id,
        reason: 'Faulty',
        refundMethod: 'ACCOUNT',
        items: [{ saleItemId: line.saleItemId, qty: 1 }],
      })
      .expect(201);
    expect(await balance(customer.id)).toBe(100_000);

    const sale2 = (
      await sell(
        adminHttp,
        item.id,
        1,
        [{ method: 'CREDIT', amount: 100_000 }],
        customer.id,
      ).expect(201)
    ).body.sale;
    expect(await balance(customer.id)).toBe(200_000);
    await adminHttp.post(`/api/sales/${sale2.id}/void`).send({ reason: 'Mistake' }).expect(200);
    expect(await balance(customer.id)).toBe(100_000);
  });

  it('lets an admin correct an old balance', async () => {
    const { adminHttp, cashierHttp, customer } = await shop();
    await cashierHttp
      .post(`/api/customers/${customer.id}/adjust`)
      .send({ amount: 50_000, note: 'Old book' })
      .expect(403);
    await adminHttp
      .post(`/api/customers/${customer.id}/adjust`)
      .send({ amount: 50_000, note: 'Old book' })
      .expect(200);
    expect(await balance(customer.id)).toBe(50_000);
  });
});

describe('cash register', () => {
  it('works out the expected cash from every kind of cash movement and closes the day', async () => {
    const { adminHttp, item, customer } = await shop();
    // Cash sale 2 × 1,000 (customer gives 2,500, change 500), card sale 1,000
    await sell(adminHttp, item.id, 2, [{ method: 'CASH', amount: 250_000 }]).expect(201);
    await sell(adminHttp, item.id, 1, [{ method: 'CARD', amount: 100_000 }]).expect(201);
    // Credit sale, then the customer pays 500 in cash
    await sell(adminHttp, item.id, 1, [{ method: 'CREDIT', amount: 100_000 }], customer.id).expect(
      201,
    );
    await adminHttp
      .post(`/api/customers/${customer.id}/payments`)
      .send({ amount: 50_000, method: 'CASH' })
      .expect(200);
    // Cash in 1,000, cash out 300, expense from the drawer 200
    await adminHttp
      .post('/api/cash-sessions/current/movements')
      .send({ type: 'CASH_IN', amount: 100_000, reason: 'Change float' })
      .expect(200);
    await adminHttp
      .post('/api/cash-sessions/current/movements')
      .send({ type: 'CASH_OUT', amount: 30_000, reason: 'Bank deposit' })
      .expect(200);
    await adminHttp
      .post('/api/expenses')
      .send({
        date: '2026-10-14',
        category: 'Tea & refreshments',
        amount: 20_000,
        paidFrom: 'DRAWER',
      })
      .expect(201);
    await adminHttp
      .post('/api/expenses')
      .send({ date: '2026-10-14', category: 'Rent', amount: 5_000_000, paidFrom: 'BANK' })
      .expect(201);

    const summary = (await adminHttp.get('/api/cash-sessions/current/summary').expect(200)).body
      .summary;
    expect(summary).toMatchObject({
      openingCash: 500_000,
      cashSales: 200_000,
      cardSales: 100_000,
      creditSales: 100_000,
      customerCashPayments: 50_000,
      cashIn: 100_000,
      cashOut: 30_000,
      drawerExpenses: 20_000,
      billCount: 3,
      totalSales: 400_000,
    });
    // 5,000 + 2,000 + 500 + 1,000 − 300 − 200 = 8,000
    expect(summary.expectedCash).toBe(800_000);

    await adminHttp
      .post('/api/cash-sessions/current/close')
      .send({ countedCash: 790_000, denominations: { '5000': 1, '1000': 2 } })
      .expect(400);
    const closed = (
      await adminHttp
        .post('/api/cash-sessions/current/close')
        .send({ countedCash: 790_000, denominations: { '5000': 1, '1000': 2, '500': 1, '100': 4 } })
        .expect(200)
    ).body;
    expect(closed).toMatchObject({
      status: 'CLOSED',
      countedCash: 790_000,
      difference: -10_000,
      expectedCash: 800_000,
    });

    expect((await adminHttp.get('/api/cash-sessions/current').expect(200)).body.session).toBeNull();
    await sell(adminHttp, item.id, 1, [{ method: 'CASH', amount: 100_000 }]).expect(409);
    const report = (await adminHttp.get(`/api/cash-sessions/${closed.id}/receipt`).expect(200))
      .body;
    expect(report.blocks).toContainEqual(expect.objectContaining({ left: 'SHORT' }));
  });

  it('needs an admin PIN when a cashier takes cash out', async () => {
    const { cashierHttp } = await shop();
    const res = await cashierHttp
      .post('/api/cash-sessions/current/movements')
      .send({ type: 'CASH_OUT', amount: 10_000, reason: 'Lunch' })
      .expect(403);
    expect(res.body.code).toBe('APPROVAL_REQUIRED');
    await cashierHttp
      .post('/api/cash-sessions/current/movements')
      .send({ type: 'CASH_IN', amount: 10_000, reason: 'Float' })
      .expect(200);
  });
});

describe('expenses', () => {
  it('records and cancels expenses; totals leave out cancelled ones', async () => {
    const { adminHttp } = await shop();
    const a = (
      await adminHttp
        .post('/api/expenses')
        .send({ date: '2026-10-01', category: 'Electricity', amount: 1_200_000, paidFrom: 'BANK' })
        .expect(201)
    ).body;
    await adminHttp
      .post('/api/expenses')
      .send({ date: '2026-10-02', category: 'Water', amount: 300_000, paidFrom: 'OTHER' })
      .expect(201);
    await adminHttp
      .post(`/api/expenses/${a.id}/cancel`)
      .send({ reason: 'Entered twice' })
      .expect(200);
    const list = (await adminHttp.get('/api/expenses?from=2026-10-01&to=2026-10-31').expect(200))
      .body;
    expect(list.total).toBe(2);
    expect(list.totalAmount).toBe(300_000);
    expect((await adminHttp.get('/api/expenses/categories').expect(200)).body).toContain('Rent');
  });
});
