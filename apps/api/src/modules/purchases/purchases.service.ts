import { Injectable } from '@nestjs/common';
import {
  allocateProportionally,
  divRound,
  formatMoney,
  type Page,
  type PurchaseDto,
  type PurchaseInput,
  type PurchaseListItem,
  type PurchaseQuery,
} from '@marina/shared';
import { badRequest, conflict, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { nextDocumentNumber } from '../../prisma/counters';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { changeStock } from '../../prisma/stock';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { variantLabel } from '../catalog/products.service';

const userRef = { select: { id: true, fullName: true } } as const;
const include = {
  supplier: { select: { id: true, name: true } },
  createdBy: userRef,
  receivedBy: userRef,
  items: { include: { variant: { include: { product: true } } } },
} satisfies Prisma.PurchaseInclude;
type PurchaseRow = Prisma.PurchaseGetPayload<{ include: typeof include }>;

function toDto(p: PurchaseRow): PurchaseDto {
  return {
    id: p.id,
    number: p.number,
    status: p.status,
    supplier: p.supplier,
    supplierInvoiceNo: p.supplierInvoiceNo,
    invoiceDate: p.invoiceDate.toISOString().slice(0, 10),
    subtotal: p.subtotal,
    discount: p.discount,
    total: p.total,
    paidAmount: p.paidAmount,
    note: p.note,
    createdAt: p.createdAt.toISOString(),
    createdBy: p.createdBy,
    receivedAt: p.receivedAt?.toISOString() ?? null,
    receivedBy: p.receivedBy,
    items: p.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      name: variantLabel(i.variant.product.name, i.variant.name),
      sku: i.variant.sku,
      qty: i.qty,
      unitCost: i.unitCost,
      lineTotal: i.lineTotal,
    })),
  };
}

/** New average cost after receiving `qty` more at `unitCost` (negative stock counts as zero). */
export function averageCost(
  stockQty: number,
  currentCost: number,
  qty: number,
  unitCost: number,
): number {
  const before = Math.max(stockQty, 0);
  if (before + qty <= 0) return unitCost;
  return divRound(before * currentCost + qty * unitCost, before + qty);
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PurchaseQuery): Promise<Page<PurchaseListItem>> {
    const where: Prisma.PurchaseWhereInput = {
      supplierId: query.supplierId,
      status: query.status === 'all' ? undefined : query.status,
      OR: query.q
        ? [
            { number: { contains: query.q.toUpperCase() } },
            { supplierInvoiceNo: { contains: query.q, mode: 'insensitive' } },
            { supplier: { name: { contains: query.q, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.purchase.count({ where }),
      this.prisma.purchase.findMany({
        where,
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { supplier: { select: { name: true } }, items: { select: { qty: true } } },
      }),
    ]);
    return {
      items: rows.map((p) => ({
        id: p.id,
        number: p.number,
        status: p.status,
        supplierName: p.supplier.name,
        supplierInvoiceNo: p.supplierInvoiceNo,
        invoiceDate: p.invoiceDate.toISOString().slice(0, 10),
        itemCount: p.items.reduce((n, i) => n + i.qty, 0),
        total: p.total,
        paidAmount: p.paidAmount,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<PurchaseDto> {
    const row = await this.prisma.purchase.findUnique({ where: { id }, include });
    if (!row) throw notFound('Purchase');
    return toDto(row);
  }

  private async checkInput(tx: Tx, input: PurchaseInput) {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw notFound('Supplier');
    const ids = [...new Set(input.items.map((i) => i.variantId))];
    if (ids.length !== input.items.length)
      throw badRequest('An item appears twice. Put it on one line.');
    const count = await tx.productVariant.count({ where: { id: { in: ids } } });
    if (count !== ids.length) throw notFound('An item');
    const subtotal = input.items.reduce((s, i) => s + i.qty * i.unitCost, 0);
    const discount = input.discount ?? 0;
    if (discount > subtotal) throw badRequest('The discount cannot be more than the invoice');
    return { subtotal, discount, total: subtotal - discount };
  }

  /** A purchase starts as a draft; stock changes only when it is received. */
  async create(input: PurchaseInput, actor: Actor): Promise<PurchaseDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const totals = await this.checkInput(tx, input);
      const number = await nextDocumentNumber(tx, 'PUR');
      const row = await tx.purchase.create({
        data: {
          number,
          supplierId: input.supplierId,
          supplierInvoiceNo: input.supplierInvoiceNo ?? null,
          invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          note: input.note ?? null,
          createdById: actor.user.id,
          items: {
            create: input.items.map((i) => ({
              variantId: i.variantId,
              qty: i.qty,
              unitCost: i.unitCost,
              lineTotal: i.qty * i.unitCost,
            })),
          },
        },
      });
      await this.audit.log(
        {
          action: 'PURCHASE_CREATE',
          userId: actor.user.id,
          entityType: 'Purchase',
          entityId: row.id,
          summary: `Purchase ${number} drafted (${formatMoney(totals.total, { showCents: true })})`,
        },
        tx,
      );
      return row.id;
    });
    return this.get(id);
  }

  async update(id: string, input: PurchaseInput, actor: Actor): Promise<PurchaseDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.purchase.findUnique({ where: { id } });
      if (!current) throw notFound('Purchase');
      if (current.status !== 'DRAFT') throw conflict('Only draft purchases can be changed');
      const totals = await this.checkInput(tx, input);
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchase.update({
        where: { id },
        data: {
          supplierId: input.supplierId,
          supplierInvoiceNo: input.supplierInvoiceNo ?? null,
          invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          note: input.note ?? null,
          items: {
            create: input.items.map((i) => ({
              variantId: i.variantId,
              qty: i.qty,
              unitCost: i.unitCost,
              lineTotal: i.qty * i.unitCost,
            })),
          },
        },
      });
      await this.audit.log(
        {
          action: 'PURCHASE_UPDATE',
          userId: actor.user.id,
          entityType: 'Purchase',
          entityId: id,
          summary: `Changed draft ${current.number}`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * Goods arrived: add them to stock and update each item's average cost. The invoice discount is
   * shared over the items, so the cost reflects what was really paid.
   */
  async receive(id: string, actor: Actor): Promise<PurchaseDto> {
    await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
      if (!purchase) throw notFound('Purchase');
      // Lock the row so two people cannot receive the same purchase twice.
      const { count } = await tx.purchase.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: actor.user.id },
      });
      if (count === 0) throw conflict(`${purchase.number} was already received or cancelled`);

      const shares = allocateProportionally(
        purchase.discount,
        purchase.items.map((i) => i.lineTotal),
      );
      for (const [index, item] of purchase.items.entries()) {
        const effectiveUnitCost = divRound(item.lineTotal - shares[index]!, item.qty);
        const variant = await tx.productVariant.findUniqueOrThrow({
          where: { id: item.variantId },
        });
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            costPrice: averageCost(
              variant.stockQty,
              variant.costPrice,
              item.qty,
              effectiveUnitCost,
            ),
          },
        });
        await changeStock(tx, {
          variantId: item.variantId,
          change: item.qty,
          type: 'PURCHASE',
          userId: actor.user.id,
          refType: 'Purchase',
          refId: purchase.id,
          note: purchase.number,
          unitCost: effectiveUnitCost,
        });
      }
      await this.audit.log(
        {
          action: 'PURCHASE_RECEIVE',
          userId: actor.user.id,
          entityType: 'Purchase',
          entityId: id,
          summary: `Received ${purchase.number}: ${purchase.items.reduce((n, i) => n + i.qty, 0)} item(s) into stock`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async cancel(id: string, actor: Actor): Promise<PurchaseDto> {
    const purchase = await this.prisma.purchase.findUnique({ where: { id } });
    if (!purchase) throw notFound('Purchase');
    const { count } = await this.prisma.purchase.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'CANCELLED' },
    });
    if (count === 0) throw conflict('Only draft purchases can be cancelled');
    await this.audit.log({
      action: 'PURCHASE_CANCEL',
      userId: actor.user.id,
      entityType: 'Purchase',
      entityId: id,
      summary: `Cancelled draft ${purchase.number}`,
    });
    return this.get(id);
  }
}
