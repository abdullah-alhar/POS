import { useMemo } from 'react';
import { calculateCart, CartCalcError, type CartTotals } from '@marina/shared';
import { usePublicSettings } from '@/lib/queries';
import { unitPriceOf, useCart } from '@/stores/cart';

/** The bill worked out with the same function the server uses at checkout. */
export function useCartTotals(): { totals: CartTotals; error: string | null } {
  const { data: settings } = usePublicSettings();
  const lines = useCart((s) => s.lines);
  const priceMode = useCart((s) => s.priceMode);
  const billDiscount = useCart((s) => s.billDiscount);
  const pricesIncludeTax = settings?.tax.pricesIncludeTax ?? true;
  const roundingStep = settings?.pos.roundingStep ?? 100;

  return useMemo(() => {
    const input = lines.map((l) => ({
      key: l.key,
      unitPrice: unitPriceOf(l, priceMode),
      qty: l.qty,
      discount: l.discount,
      taxRateBp: l.taxRateBp,
    }));
    try {
      return {
        totals: calculateCart(input, billDiscount, { pricesIncludeTax, roundingStep }),
        error: null,
      };
    } catch (err) {
      const message = err instanceof CartCalcError ? err.message : 'Could not work out the bill';
      return {
        totals: calculateCart([], null, { pricesIncludeTax, roundingStep }),
        error: message,
      };
    }
  }, [lines, priceMode, billDiscount, pricesIncludeTax, roundingStep]);
}
