import { HttpStatus, Injectable } from '@nestjs/common';
import {
  bpToPercentText,
  calculateCart,
  CartCalcError,
  discountPercentBp,
  formatMoney,
  hasPermission,
  PAYMENT_METHOD_LABELS,
  summarizePayments,
  type CheckoutInput,
  type QuoteInput,
  quoteSchema,
  type CheckoutResult,
  type Page,
  type SaleDto,
  type SaleListItem,
  type SaleQuery,
  type VoidSaleInput,
} from '@shoppos/shared';
import {
  AppException,
  badRequest,
  conflict,
  forbidden,
  notFound,
} from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { nextDocumentNumber } from '../../prisma/counters';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService, type ApprovalNeed } from '../auth/approvals.service';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { variantLabel } from '../catalog/products.service';
import { SettingsService } from '../settings/settings.service';

const userRef = { select: { id: true, fullName: true } } as const;

export const saleInclude = {
  cashier: userRef,
  customer: { select: { id: true, name: true, phone: true } },
  voidedBy: userRef,
  voidApprovedBy: userRef,
  items: { orderBy: { lineNo: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SaleInclude;

type SaleWithRelations = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

export function toSaleDto(s: SaleWithRelations): SaleDto {
  return {
    id: s.id,
    clientId: s.clientId,
    number: s.number,
    status: s.status,
    priceMode: s.priceMode,
    createdAt: s.createdAt.toISOString(),
    cashier: s.cashier,
    customer: s.customer,
    subtotal: s.subtotal,
    itemDiscountTotal: s.itemDiscountTotal,
    billDiscountType: s.billDiscountType,
    billDiscountValue: s.billDiscountValue,
    billDiscountAmount: s.billDiscountAmount,
    taxTotal: s.taxTotal,
    roundingAdjustment: s.roundingAdjustment,
    total: s.total,
    paidTotal: s.paidTotal,
    changeGiven: s.changeGiven,
    note: s.note,
    items: s.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productName: i.productName,
      variantName: i.variantName,
      sku: i.sku,
      qty: i.qty,
      listPrice: i.listPrice,
      unitPrice: i.unitPrice,
      discountType: i.discountType,
      discountValue: i.discountValue,
      discountAmount: i.discountAmount,
      billDiscountShare: i.billDiscountShare,
      taxRateBp: i.taxRateBp,
      taxAmount: i.taxAmount,
      lineTotal: i.lineTotal,
      returnedQty: i.returnedQty,
      warrantyDays: i.warrantyDays,
    })),
    payments: s.payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      tendered: p.tendered,
      reference: p.reference,
    })),
    voidedAt: s.voidedAt?.toISOString() ?? null,
    voidedBy: s.voidedBy,
    voidApprovedBy: s.voidApprovedBy,
    voidReason: s.voidReason,
  };
}

/** "2026-10-13" → start of that day in the shop's (server's) time zone. */
function dayStart(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
    private readonly cash: CashRegisterService,
  ) {}

  // ───────────── Quotation ─────────────

  /**
   * The bill on the screen worked out like a sale, for printing as a quotation. Nothing is saved,
   * no stock moves and no approval is needed (it is only a price offer).
   */
  async quote(input: QuoteInput, actor: Actor): Promise<SaleDto> {
    const parsed = quoteSchema.parse(input);
    const pos = this.settings.get('pos');
    const tax = this.settings.get('tax');
    const ids = [...new Set(parsed.lines.map((l) => l.variantId))];
    const [variants, defaultRate, customer] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { id: { in: ids } },
        include: { product: { include: { taxRate: true } } },
      }),
      this.prisma.taxRate.findFirst({ where: { isDefault: true } }),
      parsed.customerId
        ? this.prisma.customer.findUnique({ where: { id: parsed.customerId } })
        : null,
    ]);
    const byId = new Map(variants.map((v) => [v.id, v]));
    if (ids.some((id) => !byId.has(id))) throw notFound('An item on this bill');
    const taxRateOf = (v: (typeof variants)[number]) =>
      tax.vatRegistered ? (v.product.taxRate?.rateBp ?? defaultRate?.rateBp ?? 0) : 0;
    let calc: ReturnType<typeof calculateCart>;
    try {
      calc = calculateCart(
        parsed.lines.map((l, i) => ({
          key: String(i),
          unitPrice: l.unitPrice,
          qty: l.qty,
          discount: l.discount ?? null,
          taxRateBp: taxRateOf(byId.get(l.variantId)!),
        })),
        parsed.billDiscount ?? null,
        { pricesIncludeTax: tax.pricesIncludeTax, roundingStep: pos.roundingStep },
      );
    } catch (err) {
      if (err instanceof CartCalcError) throw badRequest(err.message);
      throw err;
    }
    return {
      id: 'quote',
      clientId: 'quote',
      number: 'QUOTATION',
      status: 'COMPLETED',
      priceMode: parsed.priceMode,
      createdAt: new Date().toISOString(),
      cashier: { id: actor.user.id, fullName: actor.user.fullName },
      customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
      subtotal: calc.subtotal,
      itemDiscountTotal: calc.itemDiscountTotal,
      billDiscountType: parsed.billDiscount?.value ? parsed.billDiscount.type : null,
      billDiscountValue: parsed.billDiscount?.value ? parsed.billDiscount.value : null,
      billDiscountAmount: calc.billDiscountAmount,
      taxTotal: calc.taxTotal,
      roundingAdjustment: calc.roundingAdjustment,
      total: calc.total,
      paidTotal: 0,
      changeGiven: 0,
      note: null,
      items: parsed.lines.map((l, i) => {
        const v = byId.get(l.variantId)!;
        const r = calc.lines[i]!;
        return {
          id: String(i),
          variantId: v.id,
          productName: v.product.name,
          variantName: v.name,
          sku: v.sku,
          qty: l.qty,
          listPrice: l.listPrice,
          unitPrice: l.unitPrice,
          discountType: l.discount?.value ? l.discount.type : null,
          discountValue: l.discount?.value ? l.discount.value : null,
          discountAmount: r.discountAmount,
          billDiscountShare: r.billDiscountShare,
          taxRateBp: taxRateOf(v),
          taxAmount: r.taxAmount,
          lineTotal: r.lineTotal,
          returnedQty: 0,
          warrantyDays: v.product.warrantyDays,
        };
      }),
      payments: [],
      voidedAt: null,
      voidedBy: null,
      voidApprovedBy: null,
      voidReason: null,
    };
  }

  // ───────────── Checkout ─────────────

  /**
   * Save a bill. Everything (bill number, items, payments, stock, audit) is written in one
   * database transaction, so a bill is either completely saved or not saved at all.
   * Sending the same bill again (same clientId) returns the bill saved the first time.
   */
  async checkout(input: CheckoutInput, actor: Actor): Promise<CheckoutResult> {
    const already = await this.findByClientId(input.clientId);
    if (already) return { sale: already, warnings: [], duplicate: true };

    const pos = this.settings.get('pos');
    const tax = this.settings.get('tax');
    const limits = this.settings.get('approvals');

    // Load every item on the bill.
    const ids = [...new Set(input.lines.map((l) => l.variantId))];
    const [variants, defaultRate] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { id: { in: ids } },
        include: { product: { include: { taxRate: true } } },
      }),
      this.prisma.taxRate.findFirst({ where: { isDefault: true } }),
    ]);
    const byId = new Map(variants.map((v) => [v.id, v]));
    for (const id of ids) {
      const v = byId.get(id);
      if (!v) throw notFound('An item on this bill');
      if (!v.isActive || !v.product.isActive) {
        throw badRequest(
          `"${variantLabel(v.product.name, v.name)}" can no longer be sold. Remove it from the bill.`,
        );
      }
    }
    const listPriceOf = (v: (typeof variants)[number]) =>
      input.priceMode === 'WHOLESALE' ? v.wholesalePrice : v.retailPrice;
    const taxRateOf = (v: (typeof variants)[number]) =>
      tax.vatRegistered ? (v.product.taxRate?.rateBp ?? defaultRate?.rateBp ?? 0) : 0;

    // The till must have used today's prices.
    const changed = input.lines
      .map((l) => ({ line: l, v: byId.get(l.variantId)! }))
      .filter(({ line, v }) => listPriceOf(v) !== line.listPrice);
    if (changed.length) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'PRICE_CHANGED',
        'Some prices changed while this bill was open. The bill has been updated; please check the total.',
        {
          details: {
            prices: changed.map(({ v }) => ({
              variantId: v.id,
              retailPrice: v.retailPrice,
              wholesalePrice: v.wholesalePrice,
            })),
          },
        },
      );
    }

    // Work the bill out again on the server.
    let calc: ReturnType<typeof calculateCart>;
    try {
      calc = calculateCart(
        input.lines.map((l, i) => ({
          key: String(i),
          unitPrice: l.unitPrice,
          qty: l.qty,
          discount: l.discount ?? null,
          taxRateBp: taxRateOf(byId.get(l.variantId)!),
        })),
        input.billDiscount ?? null,
        { pricesIncludeTax: tax.pricesIncludeTax, roundingStep: pos.roundingStep },
      );
    } catch (err) {
      if (err instanceof CartCalcError) throw badRequest(err.message);
      throw err;
    }
    if (calc.total !== input.expectedTotal) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'PRICE_CHANGED',
        `The bill total should be ${formatMoney(calc.total, { showCents: true })}. Please check the bill.`,
        { details: { total: calc.total } },
      );
    }

    const pay = summarizePayments(calc.total, input.payments);
    if (pay.error) throw badRequest(pay.error);
    if (!pay.complete) {
      throw badRequest(
        `The bill is not fully paid. Still to pay: ${formatMoney(pay.remaining, { showCents: pos.showCents })}`,
      );
    }

    // Credit (pay later) needs a customer, the right permission and room under their limit.
    const creditTotal = input.payments.reduce(
      (sum, p, i) => sum + (p.method === 'CREDIT' ? pay.applied[i]! : 0),
      0,
    );
    const customer = input.customerId
      ? await this.prisma.customer.findUnique({ where: { id: input.customerId } })
      : null;
    if (input.customerId && (!customer || !customer.isActive)) throw notFound('Customer');
    if (creditTotal > 0) {
      if (!customer) throw badRequest('Choose the customer to sell on credit');
      if (!hasPermission(actor.user, 'customers.credit')) {
        throw forbidden('You are not allowed to sell on credit. Ask the shop owner.');
      }
    }

    // Price overrides, big discounts and credit above the limit need an admin PIN for a cashier.
    const needs: ApprovalNeed[] = [];
    if (customer && creditTotal > 0 && customer.balance + creditTotal > customer.creditLimit) {
      needs.push({
        action: 'CREDIT_LIMIT',
        message: `Admin approval needed: ${customer.name} would owe ${formatMoney(customer.balance + creditTotal, { showCents: pos.showCents })}, above the limit of ${formatMoney(customer.creditLimit, { showCents: pos.showCents })}`,
      });
    }
    const overridden = input.lines.filter((l) => l.unitPrice !== l.listPrice);
    if (overridden.length) {
      const first = byId.get(overridden[0]!.variantId)!;
      needs.push({
        action: 'PRICE_CHANGE',
        message: `Admin approval needed: price changed for "${variantLabel(first.product.name, first.name)}"${overridden.length > 1 ? ` and ${overridden.length - 1} more` : ''}`,
      });
    }
    const discountBp = discountPercentBp(calc.discountTotal, calc.subtotal);
    if (discountBp > limits.cashierMaxDiscountBp) {
      needs.push({
        action: 'LARGE_DISCOUNT',
        message: `Admin approval needed: ${bpToPercentText(discountBp)}% discount is above the cashier limit of ${bpToPercentText(limits.cashierMaxDiscountBp)}%`,
      });
    }
    const approvedBy = await this.approvals.requireAll(actor, needs);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const session = await this.cash.requireOpen(tx);
        const number = await nextDocumentNumber(tx, 'INV');

        const sale = await tx.sale.create({
          data: {
            clientId: input.clientId,
            number,
            priceMode: input.priceMode,
            customerId: customer?.id ?? null,
            cashierId: actor.user.id,
            cashSessionId: session.id,
            subtotal: calc.subtotal,
            itemDiscountTotal: calc.itemDiscountTotal,
            billDiscountType: input.billDiscount?.value ? input.billDiscount.type : null,
            billDiscountValue: input.billDiscount?.value ? input.billDiscount.value : null,
            billDiscountAmount: calc.billDiscountAmount,
            taxTotal: calc.taxTotal,
            roundingAdjustment: calc.roundingAdjustment,
            total: calc.total,
            paidTotal: calc.total,
            changeGiven: pay.change,
            costTotal: input.lines.reduce(
              (s, l) => s + byId.get(l.variantId)!.costPrice * l.qty,
              0,
            ),
            note: input.note,
            discountApprovedById: approvedBy.LARGE_DISCOUNT ?? null,
            items: {
              create: input.lines.map((l, i) => {
                const v = byId.get(l.variantId)!;
                const r = calc.lines[i]!;
                return {
                  lineNo: i + 1,
                  variantId: v.id,
                  productName: v.product.name,
                  variantName: v.name,
                  sku: v.sku,
                  qty: l.qty,
                  listPrice: l.listPrice,
                  unitPrice: l.unitPrice,
                  priceApprovedById:
                    l.unitPrice !== l.listPrice ? (approvedBy.PRICE_CHANGE ?? null) : null,
                  discountType: l.discount?.value ? l.discount.type : null,
                  discountValue: l.discount?.value ? l.discount.value : null,
                  discountAmount: r.discountAmount,
                  billDiscountShare: r.billDiscountShare,
                  taxRateBp: taxRateOf(v),
                  taxAmount: r.taxAmount,
                  lineTotal: r.lineTotal,
                  unitCost: v.costPrice,
                  warrantyDays: v.product.warrantyDays,
                };
              }),
            },
            payments: {
              create: input.payments.map((p, i) => ({
                method: p.method,
                amount: pay.applied[i]!,
                tendered: p.method === 'CASH' ? p.amount : null,
                reference: p.reference || null,
              })),
            },
          },
          include: saleInclude,
        });

        // Take the items out of stock, and record every change.
        const noStock: string[] = [];
        for (const l of input.lines) {
          const v = byId.get(l.variantId)!;
          if (!v.product.trackStock) continue;
          const { stockQty } = await tx.productVariant.update({
            where: { id: v.id },
            data: { stockQty: { decrement: l.qty } },
            select: { stockQty: true },
          });
          const name = variantLabel(v.product.name, v.name);
          if (stockQty < 0) {
            if (!pos.allowZeroStockSale) {
              throw conflict(`Not enough stock for "${name}": only ${stockQty + l.qty} left`);
            }
            noStock.push(`"${name}" was sold with no stock left (stock is now ${stockQty}).`);
          }
          await tx.stockMovement.create({
            data: {
              variantId: v.id,
              type: 'SALE',
              qtyChange: -l.qty,
              qtyAfter: stockQty,
              unitCost: v.costPrice,
              refType: 'Sale',
              refId: sale.id,
              note: number,
              userId: actor.user.id,
            },
          });
        }

        if (customer && creditTotal > 0) {
          const updated = await tx.customer.update({
            where: { id: customer.id },
            data: { balance: { increment: creditTotal } },
          });
          await tx.customerLedger.create({
            data: {
              customerId: customer.id,
              type: 'CREDIT_SALE',
              amount: creditTotal,
              balanceAfter: updated.balance,
              method: 'CREDIT',
              refType: 'Sale',
              refId: sale.id,
              note: number,
              userId: actor.user.id,
              cashSessionId: session.id,
            },
          });
        }

        const methods = [
          ...new Set(input.payments.map((p) => PAYMENT_METHOD_LABELS[p.method])),
        ].join(' + ');
        await this.audit.log(
          {
            action: 'SALE_CREATE',
            userId: actor.user.id,
            approvedById:
              approvedBy.LARGE_DISCOUNT ??
              approvedBy.PRICE_CHANGE ??
              approvedBy.CREDIT_LIMIT ??
              null,
            entityType: 'Sale',
            entityId: sale.id,
            summary: `Bill ${number}: ${formatMoney(calc.total, { showCents: true })} (${methods})`,
            meta: {
              priceOverrides: overridden.length,
              discountBp,
              approvals: approvedBy,
            },
          },
          tx,
        );
        if (noStock.length) {
          await this.audit.log(
            {
              action: 'SALE_NO_STOCK',
              userId: actor.user.id,
              entityType: 'Sale',
              entityId: sale.id,
              summary: `Bill ${number} sold ${noStock.length} item(s) with no stock`,
              meta: { items: noStock },
            },
            tx,
          );
        }

        return { sale: toSaleDto(sale), warnings: noStock, duplicate: false };
      });
    } catch (err) {
      // Two identical requests at the same moment: the second one returns the first one's bill.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.findByClientId(input.clientId);
        if (existing) return { sale: existing, warnings: [], duplicate: true };
      }
      throw err;
    }
  }

  private async findByClientId(clientId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { clientId }, include: saleInclude });
    return sale ? toSaleDto(sale) : null;
  }

  // ───────────── Reading ─────────────

  async list(query: SaleQuery, actor: Actor): Promise<Page<SaleListItem>> {
    const where: Prisma.SaleWhereInput = {
      status: query.status === 'all' ? undefined : query.status,
      cashierId: hasPermission(actor.user, 'sales.viewAll') ? query.cashierId : actor.user.id,
    };
    // Bill number, or customer name / phone.
    if (query.q) {
      where.OR = [
        { number: { contains: query.q.toUpperCase() } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
        { customer: { phone: { contains: query.q.replace(/\s/g, '') } } },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = {
        gte: query.from ? dayStart(query.from) : undefined,
        lt: query.to ? new Date(dayStart(query.to).getTime() + 86_400_000) : undefined,
      };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          cashier: userRef,
          customer: { select: { name: true } },
          items: { select: { qty: true } },
          payments: { select: { method: true } },
        },
      }),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        number: s.number,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        cashierName: s.cashier.fullName,
        customerName: s.customer?.name ?? null,
        itemCount: s.items.reduce((n, i) => n + i.qty, 0),
        total: s.total,
        methods: [...new Set(s.payments.map((p) => p.method))],
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** The newest completed bill this user may see (for the receipt designer's preview). */
  async latestCompleted(actor: Actor): Promise<SaleDto | null> {
    const sale = await this.prisma.sale.findFirst({
      where: {
        status: 'COMPLETED',
        ...(hasPermission(actor.user, 'sales.viewAll') ? {} : { cashierId: actor.user.id }),
      },
      orderBy: { createdAt: 'desc' },
      include: saleInclude,
    });
    return sale ? toSaleDto(sale) : null;
  }

  /** A bill by its number, e.g. to preview the receipt design with it. */
  async byNumber(number: string, actor: Actor): Promise<SaleDto | null> {
    const sale = await this.prisma.sale.findFirst({
      where: {
        number: number.trim().toUpperCase(),
        ...(hasPermission(actor.user, 'sales.viewAll') ? {} : { cashierId: actor.user.id }),
      },
      include: saleInclude,
    });
    return sale ? toSaleDto(sale) : null;
  }

  async get(id: string, actor: Actor): Promise<SaleDto> {
    const sale = await this.prisma.sale.findUnique({ where: { id }, include: saleInclude });
    if (
      !sale ||
      (!hasPermission(actor.user, 'sales.viewAll') && sale.cashierId !== actor.user.id)
    ) {
      throw notFound('Bill');
    }
    return toSaleDto(sale);
  }

  // ───────────── Void ─────────────

  /**
   * Cancel a bill: it stays in the records marked VOIDED, and the items go back into stock.
   * Bills that already have returns must be handled with a return instead.
   */
  async void(id: string, input: VoidSaleInput, actor: Actor): Promise<SaleDto> {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: { ...saleInclude, _count: { select: { returns: true } } },
    });
    if (!sale) throw notFound('Bill');
    if (sale.status === 'VOIDED') throw conflict(`${sale.number} is already voided`);
    if (sale._count.returns > 0)
      throw conflict(`${sale.number} has returns. Use a return instead of a void.`);

    const approverId = hasPermission(actor.user, 'sales.void')
      ? null
      : await this.approvals.require(
          actor,
          'VOID_SALE',
          `Admin approval needed to void ${sale.number}`,
        );

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.sale.updateMany({
        where: { id, status: 'COMPLETED' },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedById: actor.user.id,
          voidApprovedById: approverId,
          voidReason: input.reason,
        },
      });
      if (count === 0) throw conflict(`${sale.number} is already voided`);

      const tracked = await tx.productVariant.findMany({
        where: { id: { in: sale.items.map((i) => i.variantId) }, product: { trackStock: true } },
        select: { id: true },
      });
      const trackedIds = new Set(tracked.map((t) => t.id));
      for (const item of sale.items) {
        if (!trackedIds.has(item.variantId)) continue;
        const { stockQty } = await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stockQty: { increment: item.qty } },
          select: { stockQty: true },
        });
        await tx.stockMovement.create({
          data: {
            variantId: item.variantId,
            type: 'SALE_VOID',
            qtyChange: item.qty,
            qtyAfter: stockQty,
            refType: 'Sale',
            refId: sale.id,
            note: `Void ${sale.number}`,
            userId: actor.user.id,
          },
        });
      }

      // Money the customer owed for this bill is taken off their account again.
      const credit = sale.payments
        .filter((p) => p.method === 'CREDIT')
        .reduce((sum, p) => sum + p.amount, 0);
      if (sale.customerId && credit > 0) {
        const updated = await tx.customer.update({
          where: { id: sale.customerId },
          data: { balance: { decrement: credit } },
        });
        await tx.customerLedger.create({
          data: {
            customerId: sale.customerId,
            type: 'ADJUSTMENT',
            amount: -credit,
            balanceAfter: updated.balance,
            refType: 'Sale',
            refId: sale.id,
            note: `Void ${sale.number}`,
            userId: actor.user.id,
          },
        });
      }

      await this.audit.log(
        {
          action: 'SALE_VOID',
          userId: actor.user.id,
          approvedById: approverId,
          entityType: 'Sale',
          entityId: sale.id,
          summary: `Voided ${sale.number} (${formatMoney(sale.total, { showCents: true })}): ${input.reason}`,
        },
        tx,
      );
      return tx.sale.findUniqueOrThrow({ where: { id }, include: saleInclude });
    });
    return toSaleDto(updated);
  }
}
