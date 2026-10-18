import { Injectable } from '@nestjs/common';
import type {
  CashierReportRow,
  Dashboard,
  PaymentReportRow,
  ProductReportQuery,
  ProductReportRow,
  ReportGroup,
  ReportRange,
  SalesReport,
  SalesReportRow,
  StockValueReport,
} from '@shoppos/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { variantLabel } from '../catalog/products.service';

/** The shop's time zone is the server's (the till and the server are the same laptop). */
export function shopTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** "2026-10-13" → start of that day in the shop's time zone. */
function dayStart(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}
/** Start of the day after `date`, so ranges include the whole last day. */
function dayAfter(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d + 1);
}
/** Today in the shop's time zone, YYYY-MM-DD. */
export function localToday(now = new Date()) {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
}
/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** First day of the period that contains `date` (weeks start on Monday, like PostgreSQL). */
export function periodStart(date: string, group: ReportGroup) {
  if (group === 'day') return date;
  if (group === 'month') return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}
/** Every period start from `from` to `to`, so charts show empty days too. */
export function periodsBetween(from: string, to: string, group: ReportGroup) {
  const out: string[] = [];
  let p = periodStart(from, group);
  while (p <= to && out.length < 2000) {
    out.push(p);
    if (group === 'day') p = addDays(p, 1);
    else if (group === 'week') p = addDays(p, 7);
    else {
      const [y, m] = p.split('-').map(Number) as [number, number];
      p = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    }
  }
  return out;
}

const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

const EMPTY_ROW: Omit<SalesReportRow, 'period'> = {
  bills: 0,
  sales: 0,
  discounts: 0,
  returns: 0,
  netSales: 0,
  tax: 0,
  cost: 0,
  grossProfit: 0,
  expenses: 0,
  netProfit: 0,
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sales, returns, cost, profit and expenses per day, week or month. */
  async sales(range: ReportRange, group: ReportGroup): Promise<SalesReport> {
    const tz = shopTimeZone();
    const start = dayStart(range.from);
    const end = dayAfter(range.to);
    const bucket = (col: string) =>
      Prisma.raw(`date_trunc('${group}', ${col} AT TIME ZONE '${tz.replace(/'/g, '')}')::date`);

    const [sales, returns, returnCost, expenses] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT ${bucket('s."createdAt"')} AS period, count(*) AS bills, sum(s."total") AS sales,
               sum(s."itemDiscountTotal" + s."billDiscountAmount") AS discounts,
               sum(s."taxTotal") AS tax, sum(s."costTotal") AS cost
        FROM "Sale" s
        WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
        GROUP BY 1`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT ${bucket('r."createdAt"')} AS period, sum(r."total") AS returns, sum(r."taxTotal") AS tax
        FROM "SaleReturn" r
        WHERE r."createdAt" >= ${start} AND r."createdAt" < ${end}
        GROUP BY 1`,
      // Items put back on the shelf give their cost back; damaged ones stay a loss.
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT ${bucket('r."createdAt"')} AS period, sum(ri."qty" * si."unitCost") AS cost
        FROM "SaleReturnItem" ri
        JOIN "SaleReturn" r ON r."id" = ri."returnId"
        JOIN "SaleItem" si ON si."id" = ri."saleItemId"
        WHERE ri."restock" AND r."createdAt" >= ${start} AND r."createdAt" < ${end}
        GROUP BY 1`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT date_trunc(${group}, e."date"::timestamp)::date AS period, sum(e."amount") AS amount
        FROM "Expense" e
        WHERE e."cancelledAt" IS NULL AND e."date" >= ${range.from}::date AND e."date" <= ${range.to}::date
        GROUP BY 1`,
    ]);

    const rows = new Map<string, SalesReportRow>(
      periodsBetween(range.from, range.to, group).map((p) => [p, { period: p, ...EMPTY_ROW }]),
    );
    const row = (period: unknown) => {
      const key = iso(period);
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { period: key, ...EMPTY_ROW }));
      return r;
    };
    for (const s of sales) {
      const r = row(s.period);
      r.bills = n(s.bills);
      r.sales = n(s.sales);
      r.discounts = n(s.discounts);
      r.tax = n(s.tax);
      r.cost = n(s.cost);
    }
    for (const x of returns) {
      const r = row(x.period);
      r.returns = n(x.returns);
      r.tax -= n(x.tax);
    }
    for (const x of returnCost) row(x.period).cost -= n(x.cost);
    for (const x of expenses) row(x.period).expenses = n(x.amount);

    const list = [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
    const totals = { ...EMPTY_ROW };
    for (const r of list) {
      r.netSales = r.sales - r.returns;
      r.grossProfit = r.netSales - r.tax - r.cost;
      r.netProfit = r.grossProfit - r.expenses;
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
    }
    return { rows: list, totals };
  }

  /** Best sellers (most sold) or slow movers (in stock but hardly sold). */
  async products(q: ProductReportQuery): Promise<ProductReportRow[]> {
    const start = dayStart(q.from);
    const end = dayAfter(q.to);
    const sold = Prisma.sql`
      SELECT si."variantId",
             sum(si."qty" - si."returnedQty") AS qty,
             sum(si."lineTotal" * (si."qty" - si."returnedQty") / si."qty") AS sales,
             sum((si."lineTotal" - si."taxAmount") * (si."qty" - si."returnedQty") / si."qty"
                 - (si."qty" - si."returnedQty") * si."unitCost") AS profit
      FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
      WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
      GROUP BY si."variantId"`;
    const rows =
      q.sort === 'best'
        ? await this.prisma.$queryRaw<Record<string, unknown>[]>`
            WITH sold AS (${sold})
            SELECT v."id", p."name" AS product, v."name" AS variant, v."sku", c."name" AS category, v."stockQty",
                   sold.qty, sold.sales, sold.profit,
                   (SELECT max(s2."createdAt") FROM "SaleItem" i2 JOIN "Sale" s2 ON s2."id" = i2."saleId"
                     WHERE i2."variantId" = v."id" AND s2."status" = 'COMPLETED') AS "lastSoldAt"
            FROM sold JOIN "ProductVariant" v ON v."id" = sold."variantId"
            JOIN "Product" p ON p."id" = v."productId" LEFT JOIN "Category" c ON c."id" = p."categoryId"
            WHERE sold.qty > 0
            ORDER BY sold.qty DESC, sold.sales DESC
            LIMIT ${q.limit}`
        : await this.prisma.$queryRaw<Record<string, unknown>[]>`
            WITH sold AS (${sold})
            SELECT v."id", p."name" AS product, v."name" AS variant, v."sku", c."name" AS category, v."stockQty",
                   coalesce(sold.qty, 0) AS qty, coalesce(sold.sales, 0) AS sales, coalesce(sold.profit, 0) AS profit,
                   (SELECT max(s2."createdAt") FROM "SaleItem" i2 JOIN "Sale" s2 ON s2."id" = i2."saleId"
                     WHERE i2."variantId" = v."id" AND s2."status" = 'COMPLETED') AS "lastSoldAt"
            FROM "ProductVariant" v
            JOIN "Product" p ON p."id" = v."productId" LEFT JOIN "Category" c ON c."id" = p."categoryId"
            LEFT JOIN sold ON sold."variantId" = v."id"
            WHERE v."isActive" AND p."isActive" AND p."trackStock" AND v."stockQty" > 0
            ORDER BY coalesce(sold.qty, 0) ASC, v."stockQty" * v."costPrice" DESC
            LIMIT ${q.limit}`;
    return rows.map((r) => ({
      variantId: String(r.id),
      name: variantLabel(String(r.product), String(r.variant ?? '')),
      sku: String(r.sku),
      category: (r.category as string | null) ?? null,
      qtySold: n(r.qty),
      sales: n(r.sales),
      profit: n(r.profit),
      stockQty: n(r.stockQty),
      lastSoldAt: r.lastSoldAt instanceof Date ? r.lastSoldAt.toISOString() : null,
    }));
  }

  /** What the stock on the shelves is worth, at cost and at retail price. */
  async stockValue(): Promise<StockValueReport> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT coalesce(c."name", 'No category') AS category, count(*) AS items,
             sum(greatest(v."stockQty", 0)) AS qty,
             sum(greatest(v."stockQty", 0)::bigint * v."costPrice") AS cost,
             sum(greatest(v."stockQty", 0)::bigint * v."retailPrice") AS retail
      FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      WHERE v."isActive" AND p."isActive" AND p."trackStock"
      GROUP BY 1 ORDER BY cost DESC NULLS LAST`;
    const list = rows.map((r) => ({
      category: String(r.category),
      items: n(r.items),
      qty: n(r.qty),
      costValue: n(r.cost),
      retailValue: n(r.retail),
    }));
    const totals = list.reduce(
      (t, r) => ({
        items: t.items + r.items,
        qty: t.qty + r.qty,
        costValue: t.costValue + r.costValue,
        retailValue: t.retailValue + r.retailValue,
      }),
      { items: 0, qty: 0, costValue: 0, retailValue: 0 },
    );
    return { rows: list, totals };
  }

  async cashiers(range: ReportRange): Promise<CashierReportRow[]> {
    const start = dayStart(range.from);
    const end = dayAfter(range.to);
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH s AS (
        SELECT "cashierId" AS uid,
               count(*) FILTER (WHERE "status" = 'COMPLETED') AS bills,
               coalesce(sum("total") FILTER (WHERE "status" = 'COMPLETED'), 0) AS sales,
               coalesce(sum("itemDiscountTotal" + "billDiscountAmount") FILTER (WHERE "status" = 'COMPLETED'), 0) AS discounts,
               count(*) FILTER (WHERE "status" = 'VOIDED') AS voids
        FROM "Sale" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY 1
      ), r AS (
        SELECT "userId" AS uid, sum("total") AS returns
        FROM "SaleReturn" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY 1
      )
      SELECT u."id", u."fullName", coalesce(s.bills, 0) AS bills, coalesce(s.sales, 0) AS sales,
             coalesce(s.discounts, 0) AS discounts, coalesce(s.voids, 0) AS voids, coalesce(r.returns, 0) AS returns
      FROM "User" u LEFT JOIN s ON s.uid = u."id" LEFT JOIN r ON r.uid = u."id"
      WHERE s.uid IS NOT NULL OR r.uid IS NOT NULL
      ORDER BY sales DESC`;
    return rows.map((r) => ({
      userId: String(r.id),
      name: String(r.fullName),
      bills: n(r.bills),
      sales: n(r.sales),
      discounts: n(r.discounts),
      voids: n(r.voids),
      returns: n(r.returns),
    }));
  }

  async payments(range: ReportRange): Promise<PaymentReportRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT p."method", count(*) AS count, sum(p."amount") AS amount
      FROM "Payment" p JOIN "Sale" s ON s."id" = p."saleId"
      WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${dayStart(range.from)} AND s."createdAt" < ${dayAfter(range.to)}
      GROUP BY 1 ORDER BY amount DESC`;
    return rows.map((r) => ({ method: String(r.method), count: n(r.count), amount: n(r.amount) }));
  }

  async dashboard(): Promise<Dashboard> {
    const today = localToday();
    const from = addDays(today, -29);
    const [report, top, payments, stock, owed, purchased, paid, open] = await Promise.all([
      this.sales({ from, to: today }, 'day'),
      this.products({ from: today, to: today, sort: 'best', limit: 5 }),
      this.payments({ from: today, to: today }),
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT count(*) FILTER (WHERE v."stockQty" <= v."reorderLevel" AND v."stockQty" > 0) AS low,
               count(*) FILTER (WHERE v."stockQty" <= 0) AS out
        FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId"
        WHERE v."isActive" AND p."isActive" AND p."trackStock"`,
      this.prisma.customer.aggregate({ where: { balance: { gt: 0 } }, _sum: { balance: true } }),
      this.prisma.purchase.groupBy({
        by: ['supplierId'],
        where: { status: 'RECEIVED' },
        _sum: { total: true },
      }),
      this.prisma.supplierPayment.groupBy({ by: ['supplierId'], _sum: { amount: true } }),
      this.prisma.cashSession.count({ where: { status: 'OPEN' } }),
    ]);
    const paidBy = new Map(paid.map((p) => [p.supplierId, p._sum.amount ?? 0]));
    const owedToSuppliers = purchased.reduce(
      (t, p) => t + Math.max(0, (p._sum.total ?? 0) - (paidBy.get(p.supplierId) ?? 0)),
      0,
    );
    const t = report.rows.find((r) => r.period === today) ?? { period: today, ...EMPTY_ROW };
    const y = report.rows.find((r) => r.period === addDays(today, -1)) ?? {
      period: today,
      ...EMPTY_ROW,
    };
    return {
      today: {
        sales: t.netSales,
        profit: t.netProfit,
        bills: t.bills,
        avgBill: t.bills ? Math.round(t.sales / t.bills) : 0,
        returns: t.returns,
        expenses: t.expenses,
      },
      yesterday: { sales: y.netSales, bills: y.bills },
      lowStock: n(stock[0]?.low),
      outOfStock: n(stock[0]?.out),
      owedByCustomers: owed._sum.balance ?? 0,
      owedToSuppliers,
      days: report.rows.map((r) => ({
        date: r.period,
        sales: r.netSales,
        profit: r.netProfit,
        bills: r.bills,
      })),
      topToday: top.map((p) => ({ name: p.name, qty: p.qtySold, sales: p.sales })),
      paymentsToday: payments,
      dayOpen: open > 0,
    };
  }
}
