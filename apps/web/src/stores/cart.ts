import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Discount, HeldCart, PosIndexItem, PriceMode } from '@shoppos/shared';
import { uuid } from '@/lib/uuid';

/**
 * The bill being rung up. Saved in the browser on every change, so a refresh or a crash never
 * loses it. `clientId` stays the same until the bill is finished, which makes a retried
 * checkout safe (the server never saves the same bill twice).
 */

export interface CartLine {
  key: string;
  variantId: string;
  name: string;
  sku: string;
  retailPrice: number;
  wholesalePrice: number;
  /** Price typed in by the cashier; null = normal retail/wholesale price. */
  overridePrice: number | null;
  qty: number;
  discount: Discount | null;
  taxRateBp: number;
  trackStock: boolean;
  /** Items with a serial number / IMEI are one per line. Older saved bills may not have these. */
  trackSerial?: boolean;
  serialNo?: string | null;
  warrantyDays?: number;
}

/** The customer on the bill (for credit sales and the receipt). */
export interface CartCustomer {
  id: string;
  name: string;
  phone: string | null;
  type: 'RETAIL' | 'WHOLESALE';
  balance: number;
  creditLimit: number;
}

export function listPriceOf(
  line: Pick<CartLine, 'retailPrice' | 'wholesalePrice'>,
  mode: PriceMode,
) {
  return mode === 'WHOLESALE' ? line.wholesalePrice : line.retailPrice;
}

export function unitPriceOf(line: CartLine, mode: PriceMode) {
  return line.overridePrice ?? listPriceOf(line, mode);
}

interface CartState {
  clientId: string;
  priceMode: PriceMode;
  customer: CartCustomer | null;
  lines: CartLine[];
  billDiscount: Discount | null;
  note: string;
  selectedKey: string | null;
  /** The last finished bill, for "reprint last" (F10). */
  lastSaleId: string | null;

  add: (item: PosIndexItem, qty?: number, serialNo?: string | null) => CartLine;
  setQty: (key: string, qty: number) => void;
  changeQty: (key: string, delta: number) => void;
  remove: (key: string) => void;
  select: (key: string | null) => void;
  moveSelection: (delta: number) => void;
  updateLine: (
    key: string,
    patch: Partial<Pick<CartLine, 'qty' | 'overridePrice' | 'discount' | 'serialNo'>>,
  ) => void;
  setBillDiscount: (discount: Discount | null) => void;
  setPriceMode: (mode: PriceMode) => void;
  /** Wholesale customers switch the bill to wholesale prices. */
  setCustomer: (customer: CartCustomer | null) => void;
  /** Start a new, empty bill. */
  reset: (defaultMode: PriceMode) => void;
  finish: (saleId: string, defaultMode: PriceMode) => void;
  /** Bring back a held bill, using today's prices for lines without a typed-in price. */
  loadHeld: (cart: HeldCart, find: (variantId: string) => PosIndexItem | undefined) => string[];
  /** After prices changed on the server: update the normal prices on the bill. */
  syncPrices: (find: (variantId: string) => PosIndexItem | undefined) => void;
  toHeld: () => HeldCart;
}

const newId = () => uuid();

function fromItem(item: PosIndexItem, qty: number): CartLine {
  return {
    key: newId(),
    variantId: item.variantId,
    name: item.name,
    sku: item.sku,
    retailPrice: item.retailPrice,
    wholesalePrice: item.wholesalePrice,
    overridePrice: null,
    qty,
    discount: null,
    taxRateBp: item.taxRateBp,
    trackStock: item.trackStock,
    trackSerial: item.trackSerial,
    serialNo: null,
    warrantyDays: item.warrantyDays,
  };
}

/**
 * Checks a new quantity against the stock: returns the quantity allowed (the billing screen sets
 * it, since it knows the stock and the "sell with no stock" setting).
 */
type StockGuard = (line: CartLine, qty: number, lines: CartLine[]) => number;
let stockGuard: StockGuard | null = null;
export function setStockGuard(guard: StockGuard | null) {
  stockGuard = guard;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      clientId: newId(),
      priceMode: 'RETAIL',
      customer: null,
      lines: [],
      billDiscount: null,
      note: '',
      selectedKey: null,
      lastSaleId: null,

      add(item, qty = 1, serialNo = null) {
        if (item.trackSerial) {
          // Each serial number / IMEI is its own line.
          const line = { ...fromItem(item, 1), serialNo };
          set((s) => ({ lines: [...s.lines, line], selectedKey: line.key }));
          return line;
        }
        const existing = get().lines.find((l) => l.variantId === item.variantId);
        if (existing) {
          const updated = { ...existing, qty: existing.qty + qty };
          set((s) => ({
            lines: s.lines.map((l) => (l.key === existing.key ? updated : l)),
            selectedKey: existing.key,
          }));
          return updated;
        }
        const line = fromItem(item, qty);
        set((s) => ({ lines: [...s.lines, line], selectedKey: line.key }));
        return line;
      },
      setQty(key, wanted) {
        const line = get().lines.find((l) => l.key === key);
        if (!line || wanted < 1) return;
        if (wanted > 1 && line.trackSerial) return;
        const qty = stockGuard ? stockGuard(line, wanted, get().lines) : wanted;
        if (qty === line.qty) return;
        set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, qty } : l)) }));
      },
      changeQty(key, delta) {
        const line = get().lines.find((l) => l.key === key);
        if (line) get().setQty(key, Math.max(1, line.qty + delta));
      },
      remove(key) {
        set((s) => {
          const index = s.lines.findIndex((l) => l.key === key);
          const lines = s.lines.filter((l) => l.key !== key);
          const next = lines[Math.min(index, lines.length - 1)];
          return {
            lines,
            selectedKey: next?.key ?? null,
            billDiscount: lines.length ? s.billDiscount : null,
          };
        });
      },
      select(key) {
        set({ selectedKey: key });
      },
      moveSelection(delta) {
        const { lines, selectedKey } = get();
        if (!lines.length) return;
        const index = lines.findIndex((l) => l.key === selectedKey);
        const next = Math.min(
          lines.length - 1,
          Math.max(0, (index < 0 ? lines.length : index) + delta),
        );
        set({ selectedKey: lines[next]!.key });
      },
      updateLine(key, patch) {
        const line = get().lines.find((l) => l.key === key);
        if (!line) return;
        const next = { ...patch };
        if (next.qty !== undefined && stockGuard)
          next.qty = stockGuard(line, next.qty, get().lines);
        set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, ...next } : l)) }));
      },
      setBillDiscount(discount) {
        set({ billDiscount: discount && discount.value > 0 ? discount : null });
      },
      setPriceMode(priceMode) {
        set({ priceMode });
      },
      setCustomer(customer) {
        set((st) => ({
          customer,
          priceMode:
            customer?.type === 'WHOLESALE' ? 'WHOLESALE' : customer ? 'RETAIL' : st.priceMode,
        }));
      },
      reset(defaultMode) {
        set({
          clientId: newId(),
          priceMode: defaultMode,
          customer: null,
          lines: [],
          billDiscount: null,
          note: '',
          selectedKey: null,
        });
      },
      finish(saleId, defaultMode) {
        get().reset(defaultMode);
        set({ lastSaleId: saleId });
      },
      loadHeld(cart, find) {
        const missing: string[] = [];
        const lines: CartLine[] = [];
        for (const held of cart.lines) {
          const item = find(held.variantId);
          if (!item) {
            missing.push(held.name);
            continue;
          }
          const line = fromItem(item, held.qty);
          // A typed-in price is kept; otherwise today's price is used.
          if (held.unitPrice !== held.listPrice) line.overridePrice = held.unitPrice;
          line.discount = held.discount ?? null;
          line.serialNo = held.serialNo ?? null;
          lines.push(line);
        }
        set({
          clientId: newId(),
          priceMode: cart.priceMode,
          customer: null,
          lines,
          billDiscount: cart.billDiscount ?? null,
          note: cart.note ?? '',
          selectedKey: lines.at(-1)?.key ?? null,
        });
        return missing;
      },
      syncPrices(find) {
        set((s) => ({
          lines: s.lines.map((l) => {
            const item = find(l.variantId);
            return item
              ? { ...l, retailPrice: item.retailPrice, wholesalePrice: item.wholesalePrice }
              : l;
          }),
        }));
      },
      toHeld() {
        const { priceMode, lines, billDiscount, note, customer } = get();
        return {
          priceMode,
          customerId: customer?.id ?? null,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            name: l.name,
            qty: l.qty,
            listPrice: listPriceOf(l, priceMode),
            unitPrice: unitPriceOf(l, priceMode),
            discount: l.discount,
            serialNo: l.serialNo ?? null,
          })),
          billDiscount,
          note: note || undefined,
        };
      },
    }),
    {
      name: 'pos-cart',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
