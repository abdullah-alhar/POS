import { Injectable } from '@nestjs/common';
import {
  ADJUSTMENT_REASON_LABELS,
  type LowStockItem,
  type MovementQuery,
  type Page,
  type StockAdjustmentDto,
  type StockAdjustmentInput,
  type StockMovementDto,
} from '@shoppos/shared';
import { badRequest, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { nextDocumentNumber } from '../../prisma/counters';
import { PrismaService } from '../../prisma/prisma.service';
import { changeStock } from '../../prisma/stock';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';
import { variantLabel } from '../catalog/products.service';

const REF_LABELS: Record<string, string> = {
  Sale: 'Bill',
  SaleReturn: 'Return',
  Purchase: 'Purchase',
  StockAdjustment: 'Adjustment',
  Product: 'New product',
};

function dayStart(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Stock history, newest first. */
  async movements(query: MovementQuery): Promise<Page<StockMovementDto>> {
    const where: Prisma.StockMovementWhereInput = {
      variantId: query.variantId,
      type: query.type,
      variant: query.productId ? { productId: query.productId } : undefined,
    };
    if (query.from || query.to) {
      where.createdAt = {
        gte: query.from ? dayStart(query.from) : undefined,
        lt: query.to ? new Date(dayStart(query.to).getTime() + 86_400_000) : undefined,
      };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { variant: { include: { product: true } }, user: { select: { fullName: true } } },
      }),
    ]);
    return {
      items: rows.map((m) => ({
        id: m.id,
        createdAt: m.createdAt.toISOString(),
        variantId: m.variantId,
        productName: m.variant.product.name,
        variantName: m.variant.name,
        sku: m.variant.sku,
        type: m.type,
        qtyChange: m.qtyChange,
        qtyAfter: m.qtyAfter,
        reference: m.refType
          ? `${REF_LABELS[m.refType] ?? m.refType}${m.note ? ` ${m.note}` : ''}`
          : null,
        note: m.refType ? null : m.note,
        userName: m.user?.fullName ?? null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Items at or below their reorder level (only products whose stock is tracked). */
  async lowStock(): Promise<LowStockItem[]> {
    const rows = await this.prisma.productVariant.findMany({
      where: {
        isActive: true,
        product: { isActive: true, trackStock: true },
        stockQty: { lte: this.prisma.productVariant.fields.reorderLevel },
      },
      include: { product: true },
      orderBy: [{ stockQty: 'asc' }, { product: { name: 'asc' } }],
      take: 500,
    });
    return rows.map((v) => ({
      variantId: v.id,
      productId: v.productId,
      name: variantLabel(v.product.name, v.name),
      sku: v.sku,
      stockQty: v.stockQty,
      reorderLevel: v.reorderLevel,
      costPrice: v.costPrice,
      retailPrice: v.retailPrice,
    }));
  }

  adjustments(page = 1, pageSize = 50): Promise<Page<StockAdjustmentDto>> {
    return this.adjustmentsWhere({}, page, pageSize);
  }

  private async adjustmentsWhere(
    where: Prisma.StockAdjustmentWhereInput,
    page: number,
    pageSize: number,
  ): Promise<Page<StockAdjustmentDto>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockAdjustment.count({ where }),
      this.prisma.stockAdjustment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
          items: { include: { variant: { include: { product: true } } } },
        },
      }),
    ]);
    return {
      items: rows.map((a) => ({
        id: a.id,
        number: a.number,
        reason: a.reason,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
        user: a.user,
        approvedBy: a.approvedBy,
        items: a.items.map((i) => ({
          variantId: i.variantId,
          name: variantLabel(i.variant.product.name, i.variant.name),
          sku: i.variant.sku,
          qtyChange: i.qtyChange,
        })),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Correct the stock (count, damage, loss…). Every line becomes an ADJUSTMENT movement.
   * Cashiers need an admin PIN.
   */
  async adjust(input: StockAdjustmentInput, actor: Actor): Promise<StockAdjustmentDto> {
    const ids = [...new Set(input.items.map((i) => i.variantId))];
    if (ids.length !== input.items.length)
      throw badRequest('An item appears twice. Put it on one line.');
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: ids } },
      include: { product: true },
    });
    if (variants.length !== ids.length) throw notFound('An item');
    const approvedBy = await this.approvals.require(
      actor,
      'STOCK_ADJUST',
      'Admin approval needed to change stock',
    );

    const id = await this.prisma.$transaction(async (tx) => {
      // Re-read stock inside the transaction, so a count is compared with the latest number.
      const current = new Map(
        (
          await tx.productVariant.findMany({
            where: { id: { in: ids } },
            select: { id: true, stockQty: true },
          })
        ).map((v) => [v.id, v.stockQty]),
      );
      const lines = input.items
        .map((i) => ({
          ...i,
          change: i.mode === 'COUNT' ? i.qty - current.get(i.variantId)! : i.qty,
        }))
        .filter((l) => l.change !== 0);
      if (!lines.length) throw badRequest('Nothing to change: the counts match the stock already.');

      const number = await nextDocumentNumber(tx, 'ADJ');
      const adjustment = await tx.stockAdjustment.create({
        data: {
          number,
          reason: input.reason,
          note: input.note,
          userId: actor.user.id,
          approvedById: approvedBy,
          items: {
            create: lines.map((l) => ({
              variantId: l.variantId,
              qtyChange: l.change,
              unitCost: variants.find((v) => v.id === l.variantId)!.costPrice,
            })),
          },
        },
      });
      for (const l of lines) {
        await changeStock(tx, {
          variantId: l.variantId,
          change: l.change,
          type: 'ADJUSTMENT',
          userId: actor.user.id,
          refType: 'StockAdjustment',
          refId: adjustment.id,
          note: number,
          unitCost: variants.find((v) => v.id === l.variantId)!.costPrice,
        });
      }
      await this.audit.log(
        {
          action: 'STOCK_ADJUST',
          userId: actor.user.id,
          approvedById: approvedBy,
          entityType: 'StockAdjustment',
          entityId: adjustment.id,
          summary: `${number}: ${ADJUSTMENT_REASON_LABELS[input.reason]}, ${lines.length} item(s)`,
          meta: { lines: lines.map((l) => ({ variantId: l.variantId, change: l.change })) },
        },
        tx,
      );
      return adjustment.id;
    });
    return (await this.adjustmentsWhere({ id }, 1, 1)).items[0]!;
  }
}
