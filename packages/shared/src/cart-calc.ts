import type { DiscountType } from './enums';
import {
  allocateProportionally,
  BP_PER_WHOLE,
  divRound,
  percentOf,
  roundToStep,
  type Cents,
} from './money';

/**
 * The one and only bill calculation. The billing screen uses it to show totals,
 * and the server runs it again at checkout, so both always agree to the cent.
 */

export type { DiscountType };

export interface Discount {
  type: DiscountType;
  /** AMOUNT: cents off the whole line or bill. PERCENT: basis points (1000 = 10%). */
  value: number;
}

export interface CartLineInput {
  /** Any stable id for the line (e.g. variant id). Returned as-is. */
  key: string;
  /** Selling price for one unit, in cents (already retail or wholesale). */
  unitPrice: Cents;
  /** Whole units, at least 1. */
  qty: number;
  discount?: Discount | null;
  /** Tax rate in basis points (0 when the shop is not VAT registered). */
  taxRateBp: number;
}

export interface CartCalcOptions {
  /** true: shelf prices already include tax (tax is extracted). false: tax is added on top. */
  pricesIncludeTax: boolean;
  /**
   * Rounding step in cents for percentage discounts and the bill total.
   * 100 = whole rupees, 1 = no rounding.
   */
  roundingStep: number;
}

export interface CartLineResult {
  key: string;
  unitPrice: Cents;
  qty: number;
  /** unitPrice × qty */
  gross: Cents;
  /** Discount given on this line only. */
  discountAmount: Cents;
  /** This line's part of the whole-bill discount. */
  billDiscountShare: Cents;
  /** What the customer pays for this line, before bill rounding (tax included if inclusive). */
  net: Cents;
  /** Tax contained in (inclusive) or added to (exclusive) `net`. */
  taxAmount: Cents;
  /** net + tax when tax is added on top, otherwise equal to net. */
  lineTotal: Cents;
}

export interface CartTotals {
  lines: CartLineResult[];
  /** Sum of gross amounts, before any discount. */
  subtotal: Cents;
  itemDiscountTotal: Cents;
  billDiscountAmount: Cents;
  discountTotal: Cents;
  taxTotal: Cents;
  /** Amount before rounding to `roundingStep`. */
  totalBeforeRounding: Cents;
  /** total − totalBeforeRounding (can be negative). */
  roundingAdjustment: Cents;
  /** Amount the customer must pay. */
  total: Cents;
  itemCount: number;
}

export class CartCalcError extends Error {}

function discountAmountFor(
  base: Cents,
  discount: Discount | null | undefined,
  step: number,
): Cents {
  if (!discount || discount.value <= 0 || base <= 0) return 0;
  if (!Number.isSafeInteger(discount.value)) {
    throw new CartCalcError('Discount must be a whole number');
  }
  let amount: Cents;
  if (discount.type === 'PERCENT') {
    if (discount.value > BP_PER_WHOLE) throw new CartCalcError('Discount cannot be more than 100%');
    amount = roundToStep(percentOf(base, discount.value), step);
  } else {
    amount = discount.value;
  }
  return Math.min(amount, base);
}

/** Tax contained in an amount that already includes tax. */
export function taxIncluded(amount: Cents, rateBp: number): Cents {
  if (rateBp <= 0) return 0;
  return amount - divRound(amount * BP_PER_WHOLE, BP_PER_WHOLE + rateBp);
}

/** Tax to add on top of an amount. */
export function taxExcluded(amount: Cents, rateBp: number): Cents {
  if (rateBp <= 0) return 0;
  return percentOf(amount, rateBp);
}

export function calculateCart(
  lines: readonly CartLineInput[],
  billDiscount: Discount | null | undefined,
  options: CartCalcOptions,
): CartTotals {
  const step = Math.max(1, Math.trunc(options.roundingStep));

  const stage1 = lines.map((line) => {
    if (!Number.isSafeInteger(line.qty) || line.qty < 1) {
      throw new CartCalcError('Quantity must be a whole number of at least 1');
    }
    if (!Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0) {
      throw new CartCalcError('Price must be zero or more');
    }
    if (!Number.isSafeInteger(line.taxRateBp) || line.taxRateBp < 0) {
      throw new CartCalcError('Tax rate must be zero or more');
    }
    const gross = line.unitPrice * line.qty;
    const discountAmount = discountAmountFor(gross, line.discount, step);
    return { line, gross, discountAmount, afterItem: gross - discountAmount };
  });

  const billBase = stage1.reduce((sum, l) => sum + l.afterItem, 0);
  const billDiscountAmount = discountAmountFor(billBase, billDiscount, step);
  const shares = allocateProportionally(
    billDiscountAmount,
    stage1.map((l) => l.afterItem),
  );

  const results: CartLineResult[] = stage1.map((l, i) => {
    const billDiscountShare = shares[i]!;
    const net = l.afterItem - billDiscountShare;
    const taxAmount = options.pricesIncludeTax
      ? taxIncluded(net, l.line.taxRateBp)
      : taxExcluded(net, l.line.taxRateBp);
    return {
      key: l.line.key,
      unitPrice: l.line.unitPrice,
      qty: l.line.qty,
      gross: l.gross,
      discountAmount: l.discountAmount,
      billDiscountShare,
      net,
      taxAmount,
      lineTotal: options.pricesIncludeTax ? net : net + taxAmount,
    };
  });

  const subtotal = results.reduce((s, l) => s + l.gross, 0);
  const itemDiscountTotal = results.reduce((s, l) => s + l.discountAmount, 0);
  const taxTotal = results.reduce((s, l) => s + l.taxAmount, 0);
  const totalBeforeRounding = results.reduce((s, l) => s + l.lineTotal, 0);
  const total = roundToStep(totalBeforeRounding, step);

  return {
    lines: results,
    subtotal,
    itemDiscountTotal,
    billDiscountAmount,
    discountTotal: itemDiscountTotal + billDiscountAmount,
    taxTotal,
    totalBeforeRounding,
    roundingAdjustment: total - totalBeforeRounding,
    total,
    itemCount: results.reduce((s, l) => s + l.qty, 0),
  };
}

/**
 * Discount as a percentage (basis points) of the amount it applies to.
 * Used to decide whether admin approval is needed.
 */
export function discountPercentBp(discountAmount: Cents, base: Cents): number {
  if (base <= 0) return 0;
  return divRound(discountAmount * BP_PER_WHOLE, base);
}
