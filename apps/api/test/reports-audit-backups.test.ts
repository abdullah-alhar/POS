import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backupFileName, parseBackupFileName } from '../src/modules/backups/backup-core';
import {
  addDays,
  localToday,
  periodsBetween,
  periodStart,
} from '../src/modules/reports/reports.service';
import { resetDb, standardUsers, startApp, type TestContext } from './helpers';

const backupDir = mkdtempSync(path.join(tmpdir(), 'shoppos-backups-'));
process.env.BACKUP_DIR = backupDir;

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => {
  await ctx.app.close();
  rmSync(backupDir, { recursive: true, force: true });
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
          { retailPrice: 100_000, wholesalePrice: 80_000, costPrice: 60_000, openingStock: 50 },
        ],
      })
      .expect(201)
  ).body.variants[0];
  await users.adminHttp.post('/api/cash-sessions/open').send({ openingCash: 500_000 }).expect(201);
  return { ...users, item };
}

type Http = Awaited<ReturnType<typeof shop>>['adminHttp'];
const sell = (http: Http, itemId: string, qty: number) =>
  http
    .post('/api/sales')
    .send({
      clientId: randomUUID(),
      priceMode: 'RETAIL',
      lines: [{ variantId: itemId, qty, listPrice: 100_000, unitPrice: 100_000 }],
      payments: [{ method: 'CASH', amount: qty * 100_000, tendered: qty * 100_000 }],
      expectedTotal: qty * 100_000,
    })
    .expect(201);

describe('report periods', () => {
  it('starts weeks on Monday and months on the 1st', () => {
    expect(periodStart('2026-10-14', 'week')).toBe('2026-10-12');
    expect(periodStart('2026-10-12', 'week')).toBe('2026-10-12');
    expect(periodStart('2026-10-18', 'week')).toBe('2026-10-12');
    expect(periodStart('2026-10-14', 'month')).toBe('2026-10-01');
    expect(periodsBetween('2026-11-20', '2027-02-03', 'month')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
    expect(periodsBetween('2026-10-30', '2026-11-02', 'day')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('reports', () => {
  it('works out sales, returns, cost, expenses and profit', async () => {
    const { adminHttp, cashierHttp, item } = await shop();
    const sale = (await sell(adminHttp, item.id, 3)).body.sale;
    await sell(cashierHttp, item.id, 1);
    // One back on the shelf, so its cost comes back too.
    await adminHttp
      .post('/api/returns')
      .send({
        saleId: sale.id,
        reason: 'Changed mind',
        refundMethod: 'CASH',
        items: [{ saleItemId: sale.items[0].id, qty: 1, restock: true }],
      })
      .expect(201);
    const today = localToday();
    await adminHttp
      .post('/api/expenses')
      .send({ date: today, category: 'Tea & refreshments', amount: 20_000, paidFrom: 'DRAWER' })
      .expect(201);

    const r = (await adminHttp.get(`/api/reports/sales?from=${today}&to=${today}`).expect(200))
      .body;
    expect(r.rows).toHaveLength(1);
    expect(r.totals).toMatchObject({
      bills: 2,
      sales: 400_000,
      returns: 100_000,
      netSales: 300_000,
      cost: 180_000,
      grossProfit: 120_000,
      expenses: 20_000,
      netProfit: 100_000,
    });

    const best = (
      await adminHttp.get(`/api/reports/products?from=${today}&to=${today}`).expect(200)
    ).body;
    expect(best[0]).toMatchObject({ name: 'Charger', qtySold: 3, sales: 300_000, profit: 120_000 });

    const cashiers = (
      await adminHttp.get(`/api/reports/cashiers?from=${today}&to=${today}`).expect(200)
    ).body;
    expect(cashiers.map((c: { bills: number }) => c.bills).sort()).toEqual([1, 1]);

    const pays = (
      await adminHttp.get(`/api/reports/payments?from=${today}&to=${today}`).expect(200)
    ).body;
    expect(pays).toEqual([{ method: 'CASH', count: 2, amount: 400_000 }]);

    const stock = (await adminHttp.get('/api/reports/stock-value').expect(200)).body;
    expect(stock.totals).toMatchObject({
      qty: 47,
      costValue: 47 * 60_000,
      retailValue: 47 * 100_000,
    });

    const dash = (await adminHttp.get('/api/reports/dashboard').expect(200)).body;
    expect(dash.today).toMatchObject({ sales: 300_000, profit: 100_000, bills: 2 });
    expect(dash.days).toHaveLength(30);
    expect(dash.dayOpen).toBe(true);
  });

  it('is for users with the reports permission only', async () => {
    const { cashierHttp } = await shop();
    await cashierHttp.get('/api/reports/dashboard').expect(403);
    await cashierHttp.get('/api/audit').expect(403);
    await cashierHttp.get('/api/backups').expect(403);
  });

  it('rejects a start date after the end date', async () => {
    const { adminHttp } = await shop();
    await adminHttp.get('/api/reports/sales?from=2026-10-10&to=2026-10-01').expect(400);
  });
});

describe('audit log', () => {
  it('lists entries newest first and filters them', async () => {
    const { adminHttp, item } = await shop();
    await sell(adminHttp, item.id, 1);
    const all = (await adminHttp.get('/api/audit?pageSize=100').expect(200)).body;
    expect(all.total).toBeGreaterThan(2);
    const sales = (await adminHttp.get('/api/audit?action=SALE_CREATE').expect(200)).body;
    expect(sales.items.every((e: { action: string }) => e.action === 'SALE_CREATE')).toBe(true);
    expect((await adminHttp.get('/api/audit/actions').expect(200)).body).toContain('SALE_CREATE');
  });
});

describe('backup file names', () => {
  it('round-trips the kind and time', () => {
    const at = new Date(2026, 9, 14, 21, 30, 5);
    const name = backupFileName('PRE_UPDATE', at);
    expect(name).toBe('shoppos_2026-10-14_213005_before-update.dump');
    expect(parseBackupFileName(name)).toEqual({ kind: 'PRE_UPDATE', date: at });
    expect(parseBackupFileName('../etc/passwd')).toBeNull();
  });
});

const canDump = !!(process.env.PG_DOCKER_CONTAINER || process.env.PG_BIN_DIR);

describe.skipIf(!canDump)('backups (needs pg_dump)', () => {
  it('backs up, refuses bad restores, and restores the data', async () => {
    const { adminHttp, item } = await shop();
    await sell(adminHttp, item.id, 1);
    const backup = (await adminHttp.post('/api/backups').expect(201)).body;
    expect(backup).toMatchObject({ kind: 'MANUAL', status: 'OK' });

    await sell(adminHttp, item.id, 2);
    expect(await ctx.prisma.sale.count()).toBe(2);

    await adminHttp
      .post('/api/backups/restore')
      .send({ fileName: backup.fileName, confirm: 'yes' })
      .expect(400);
    await adminHttp
      .post('/api/backups/restore')
      .send({ fileName: '../../x.dump', confirm: 'RESTORE' })
      .expect(400);
    const res = await adminHttp
      .post('/api/backups/restore')
      .send({ fileName: backup.fileName, confirm: 'RESTORE' })
      .expect(200);
    expect(res.body.safetyBackup).toMatch(/before-restore\.dump$/);

    expect(await ctx.prisma.sale.count()).toBe(1);
    const list = (await adminHttp.get('/api/backups').expect(200)).body;
    expect(list.map((b: { kind: string }) => b.kind).sort()).toEqual(['MANUAL', 'PRE_RESTORE']);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'BACKUP_RESTORE' } });
    expect(audit?.summary).toContain(backup.fileName);
  }, 60_000);
});
