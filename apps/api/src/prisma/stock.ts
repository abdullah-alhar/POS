import type { StockMovementType } from '../generated/prisma/client';
import type { Tx } from './prisma.service';

/**
 * The only way stock changes: update the cached stock number and write the history row
 * (StockMovement) in the same transaction. Returns the stock after the change.
 */
export async function changeStock(
  tx: Tx,
  args: {
    variantId: string;
    change: number;
    type: StockMovementType;
    userId: string;
    refType?: string;
    refId?: string;
    note?: string;
    unitCost?: number;
  },
): Promise<number> {
  const { stockQty } = await tx.productVariant.update({
    where: { id: args.variantId },
    data: { stockQty: { increment: args.change } },
    select: { stockQty: true },
  });
  await tx.stockMovement.create({
    data: {
      variantId: args.variantId,
      type: args.type,
      qtyChange: args.change,
      qtyAfter: stockQty,
      unitCost: args.unitCost ?? 0,
      refType: args.refType,
      refId: args.refId,
      note: args.note,
      userId: args.userId,
    },
  });
  return stockQty;
}
