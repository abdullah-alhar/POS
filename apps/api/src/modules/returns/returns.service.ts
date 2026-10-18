import { HttpStatus, Injectable } from '@nestjs/common';
import {
  divRound,
  formatMoney,
  hasPermission,
  REFUND_METHOD_LABELS,
  type Page,
  type ReturnableSale,
  type ReturnInput,
  type ReturnQuery,
  type SaleReturnDto,
} from '@shoppos/shared';
import { AppException, badRequest, conflict, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { nextDocumentNumber } from '../../prisma/counters';
import { PrismaService } from '../../prisma/prisma.service';
import { changeStock } from '../../prisma/stock';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';
import { variantLabel } from '../catalog/products.service';

const userRef = { select: { id: true, fullName: true } } as const;
const include = {
  sale: { select: { id: true, number: true } },
  user: userRef,
  approvedBy: userRef,
  items: { include: { saleItem: true } },
} satisfies Prisma.SaleReturnInclude;
type ReturnRow = Prisma.SaleReturnGetPayload<{ include: typeof include }>;

function toDto(r: ReturnRow): SaleReturnDto {
  return {
    id: r.id,
    number: r.number,
    createdAt: r.createdAt.toISOString(),
    sale: r.sale,
    user: r.user,
    approvedBy: r.approvedBy,
    reason: r.reason,
    refundMethod: r.refundMethod,
    total: r.total,
    taxTotal: r.taxTotal,
    items: r.items.map((i) => ({
      name: variantLabel(i.saleItem.productName, i.saleItem.variantName),
      sku: i.saleItem.sku,
      qty: i.qty,
      refundAmount: i.refundAmount,
      restock: i.restock,
    })),
  };
}

/**
 * Refund for `qty` more units of a line, as a share of what the customer really paid for it
 * (after item and bill discounts). Working it out cumulatively makes every return of the same line
 * add up exactly to the line total.
 */
export function refundShare(
  lineAmount: number,
  soldQty: number,
  returnedBefore: number,
  qty: number,
): number {
  return (
    divRound(lineAmount * (returnedBefore + qty), soldQty) -
    divRound(lineAmount * returnedBefore, soldQty)
  );
}

function dayStart(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** What can still be returned from a bill (found by id or by bill number). */
  async returnable(idOrNumber: string, actor: Actor): Promise<ReturnableSale> {
    const isNumber = !/^[0-9a-f-]{36}$/i.test(idOrNumber);
    const sale = await this.prisma.sale.findFirst({
      where: isNumber ? { number: idOrNumber.trim().toUpperCase() } : { id: idOrNumber },
      include: {
        items: { orderBy: { lineNo: 'asc' } },
        customer: { select: { id: true, name: true } },
      },
    });
    if (
      !sale ||
      (!hasPermission(actor.user, 'sales.viewAll') && sale.cashierId !== actor.user.id)
    ) {
      throw notFound('Bill');
    }
    return {
      saleId: sale.id,
      number: sale.number,
      createdAt: sale.createdAt.toISOString(),
      status: sale.status,
      customer: sale.customer,
      items: sale.items.map((i) => ({
        saleItemId: i.id,
        variantId: i.variantId,
        name: variantLabel(i.productName, i.variantName),
        sku: i.sku,
        soldQty: i.qty,
        returnedQty: i.returnedQty,
        returnableQty: i.qty - i.returnedQty,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
    };
  }

  async create(input: ReturnInput, actor: Actor): Promise<SaleReturnDto> {
    const sale = await this.prisma.sale.findUnique({
      where: { id: input.saleId },
      include: { items: true, customer: true },
    });
    if (!sale) throw notFound('Bill');
    if (sale.status === 'VOIDED')
      throw conflict(`${sale.number} is voided; nothing can be returned`);
    if (input.refundMethod === 'ACCOUNT' && !sale.customerId) {
      throw badRequest(
        "This bill has no customer, so the refund cannot go to a customer's account",
      );
    }
    const ids = input.items.map((i) => i.saleItemId);
    if (new Set(ids).size !== ids.length) throw badRequest('An item appears twice');
    for (const line of input.items) {
      const item = sale.items.find((i) => i.id === line.saleItemId);
      if (!item) throw badRequest('An item is not on this bill');
      if (line.qty > item.qty - item.returnedQty) {
        throw badRequest(
          `Only ${item.qty - item.returnedQty} of "${item.productName}" can still be returned`,
        );
      }
    }
    const approvedBy = await this.approvals.require(
      actor,
      'REFUND',
      `Admin approval needed to refund ${sale.number}`,
    );

    const id = await this.prisma.$transaction(async (tx) => {
      // Cash refunds come out of the drawer, so the day must be open.
      const session = await tx.cashSession.findFirst({ where: { status: 'OPEN' } });
      if (input.refundMethod === 'CASH' && !session) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'DAY_NOT_OPEN',
          'Open the day before giving a cash refund.',
        );
      }
      const tracked = new Set(
        (
          await tx.productVariant.findMany({
            where: {
              id: { in: sale.items.map((i) => i.variantId) },
              product: { trackStock: true },
            },
            select: { id: true },
          })
        ).map((v) => v.id),
      );

      const lines = [];
      for (const line of input.items) {
        // Re-read inside the transaction so two returns at once cannot return too much.
        const item = await tx.saleItem.findUniqueOrThrow({ where: { id: line.saleItemId } });
        if (line.qty > item.qty - item.returnedQty)
          throw conflict(`"${item.productName}" was already returned`);
        lines.push({
          line,
          item,
          refund: refundShare(item.lineTotal, item.qty, item.returnedQty, line.qty),
          tax: refundShare(item.taxAmount, item.qty, item.returnedQty, line.qty),
        });
      }
      const total = lines.reduce((s, l) => s + l.refund, 0);
      const taxTotal = lines.reduce((s, l) => s + l.tax, 0);
      const number = await nextDocumentNumber(tx, 'RET');
      const ret = await tx.saleReturn.create({
        data: {
          number,
          saleId: sale.id,
          customerId: sale.customerId,
          userId: actor.user.id,
          approvedById: approvedBy,
          cashSessionId: session?.id ?? null,
          reason: input.reason,
          refundMethod: input.refundMethod,
          total,
          taxTotal,
          items: {
            create: lines.map((l) => ({
              saleItemId: l.item.id,
              variantId: l.item.variantId,
              qty: l.line.qty,
              refundAmount: l.refund,
              taxAmount: l.tax,
              restock: l.line.restock ?? true,
            })),
          },
        },
      });
      for (const l of lines) {
        await tx.saleItem.update({
          where: { id: l.item.id },
          data: { returnedQty: { increment: l.line.qty } },
        });
        if ((l.line.restock ?? true) && tracked.has(l.item.variantId)) {
          await changeStock(tx, {
            variantId: l.item.variantId,
            change: l.line.qty,
            type: 'RETURN',
            userId: actor.user.id,
            refType: 'SaleReturn',
            refId: ret.id,
            note: number,
            unitCost: l.item.unitCost,
          });
        }
      }
      if (input.refundMethod === 'ACCOUNT' && sale.customerId) {
        const customer = await tx.customer.update({
          where: { id: sale.customerId },
          data: { balance: { decrement: total } },
        });
        await tx.customerLedger.create({
          data: {
            customerId: sale.customerId,
            type: 'RETURN',
            amount: -total,
            balanceAfter: customer.balance,
            refType: 'SaleReturn',
            refId: ret.id,
            note: `${number} (bill ${sale.number})`,
            userId: actor.user.id,
            cashSessionId: session?.id ?? null,
          },
        });
      }
      await this.audit.log(
        {
          action: 'SALE_RETURN',
          userId: actor.user.id,
          approvedById: approvedBy,
          entityType: 'SaleReturn',
          entityId: ret.id,
          summary: `${number}: refunded ${formatMoney(total, { showCents: true })} (${REFUND_METHOD_LABELS[input.refundMethod]}) for bill ${sale.number}`,
          meta: { reason: input.reason },
        },
        tx,
      );
      return ret.id;
    });
    return this.get(id);
  }

  async get(id: string): Promise<SaleReturnDto> {
    const row = await this.prisma.saleReturn.findUnique({ where: { id }, include });
    if (!row) throw notFound('Return');
    return toDto(row);
  }

  async list(query: ReturnQuery): Promise<Page<SaleReturnDto>> {
    const where: Prisma.SaleReturnWhereInput = query.q
      ? {
          OR: [
            { number: { contains: query.q.toUpperCase() } },
            { sale: { number: { contains: query.q.toUpperCase() } } },
          ],
        }
      : {};
    if (query.from || query.to) {
      where.createdAt = {
        gte: query.from ? dayStart(query.from) : undefined,
        lt: query.to ? new Date(dayStart(query.to).getTime() + 86_400_000) : undefined,
      };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.saleReturn.count({ where }),
      this.prisma.saleReturn.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toDto), total, page: query.page, pageSize: query.pageSize };
  }
}
