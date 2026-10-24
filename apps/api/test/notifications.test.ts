import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, sampleProduct, standardUsers, startApp, type TestContext } from './helpers';

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

describe('notifications', () => {
  it('tells each user what matters to them, and remembers what they have seen', async () => {
    const { adminHttp, cashierHttp } = await standardUsers(ctx);
    // The black charger starts with no stock.
    const product = (await adminHttp.post('/api/products').send(sampleProduct()).expect(201)).body;
    await adminHttp.post('/api/cash-sessions/open').send({ openingCash: 0 }).expect(201);

    const cashier = (await cashierHttp.get('/api/notifications').expect(200)).body;
    expect(cashier.items.map((n: { title: string }) => n.title)).toContain(
      '1 item is out of stock',
    );
    expect(cashier.items.every((n: { kind: string }) => n.kind === 'alert')).toBe(true);
    expect(cashier.unread).toBeGreaterThan(0);

    // A cashier voids a bill (with the admin's approval in the request): the owner hears of it.
    const white = product.variants.find((v: { name: string }) => v.name === 'White').id;
    const sale = (
      await adminHttp
        .post('/api/sales')
        .send({
          clientId: randomUUID(),
          priceMode: 'RETAIL',
          lines: [{ variantId: white, qty: 1, listPrice: 450_000, unitPrice: 450_000 }],
          payments: [{ method: 'CASH', amount: 450_000 }],
          expectedTotal: 450_000,
        })
        .expect(201)
    ).body.sale;
    await ctx.prisma.auditLog.create({
      data: {
        action: 'SALE_VOID',
        userId: (await ctx.prisma.user.findFirstOrThrow({ where: { username: 'cash' } })).id,
        entityType: 'Sale',
        entityId: sale.id,
        summary: `Voided ${sale.number}`,
      },
    });
    const owner = (await adminHttp.get('/api/notifications').expect(200)).body;
    const voided = owner.items.find((n: { title: string }) => n.title === 'A bill was voided');
    expect(voided).toMatchObject({ kind: 'event', level: 'danger', unread: true, link: '/sales' });
    expect(voided.detail).toContain(sale.number);
    // Backups are for the owner only.
    expect(owner.items.some((n: { link?: string }) => n.link === '/backups')).toBe(true);
    expect(cashier.items.some((n: { link?: string }) => n.link === '/backups')).toBe(false);

    // Opening the bell marks everything read.
    await adminHttp.post('/api/notifications/seen').expect(204);
    const after = (await adminHttp.get('/api/notifications').expect(200)).body;
    expect(after.items.filter((n: { unread: boolean }) => n.unread)).toEqual([]);
    expect(after.items.length).toBe(owner.items.length);
  });
});
