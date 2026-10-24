import { beforeEach, describe, expect, it } from 'vitest';
import type { PosIndexItem } from '@shoppos/shared';
import { setStockGuard, useCart } from './cart';

const item = {
  variantId: 'v1',
  productId: 'p1',
  name: 'USB cable',
  sku: 'P1',
  barcodes: [],
  retailPrice: 50_000,
  wholesalePrice: 40_000,
  taxRateBp: 0,
  stockQty: 2,
  trackStock: true,
  trackSerial: false,
  warrantyDays: 0,
} as unknown as PosIndexItem;

describe('cart stock guard', () => {
  beforeEach(() => {
    useCart.getState().reset('RETAIL');
    setStockGuard(null);
  });

  it('keeps every way of raising the quantity within the stock', () => {
    // Like the billing screen with "sell with no stock" switched off.
    setStockGuard((line, qty) => (qty <= item.stockQty ? qty : Math.max(line.qty, item.stockQty)));
    const line = useCart.getState().add(item, 1);
    useCart.getState().changeQty(line.key, 1);
    useCart.getState().changeQty(line.key, 1);
    useCart.getState().setQty(line.key, 9);
    useCart.getState().updateLine(line.key, { qty: 7 });
    expect(useCart.getState().lines[0]!.qty).toBe(2);
    // Lowering always works.
    useCart.getState().changeQty(line.key, -1);
    expect(useCart.getState().lines[0]!.qty).toBe(1);
  });

  it('changes nothing without a guard', () => {
    const line = useCart.getState().add(item, 1);
    useCart.getState().setQty(line.key, 5);
    expect(useCart.getState().lines[0]!.qty).toBe(5);
  });
});
