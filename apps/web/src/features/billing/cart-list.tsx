import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, ScanBarcode, ShieldCheck, Tag, Trash2, TriangleAlert } from 'lucide-react';
import {
  bpToPercentText,
  warrantyLabel,
  type CartTotals,
  type PosIndexItem,
} from '@shoppos/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { listPriceOf, unitPriceOf, useCart } from '@/stores/cart';

/** The items on the bill. Click to select, double-click (or Ctrl+D) to change. */
export function CartList({
  totals,
  stockOf,
  onEdit,
  onRemove,
  onQtyDone,
}: {
  totals: CartTotals;
  stockOf: (variantId: string) => PosIndexItem | undefined;
  onEdit: (key: string) => void;
  /** Ask before removing (the confirm dialog lives in the billing page). */
  onRemove: (key: string) => void;
  /** Called after a quantity was typed, to give the focus back to the scan box. */
  onQtyDone: () => void;
}) {
  const money = useMoney();
  const lines = useCart((s) => s.lines);
  const priceMode = useCart((s) => s.priceMode);
  const selectedKey = useCart((s) => s.selectedKey);
  const { select, changeQty, setQty } = useCart.getState();
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, lines.length]);

  if (!lines.length) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 select-none">
        <div className="bg-accent text-brand flex size-20 items-center justify-center rounded-full">
          <ScanBarcode className="size-10" />
        </div>
        <p className="text-foreground text-lg font-medium">Scan an item to start the bill</p>
        <p className="text-sm">or type its name, SKU or barcode in the box above</p>
      </div>
    );
  }

  const byKey = new Map(totals.lines.map((l) => [l.key, l]));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="text-muted-foreground bg-background/95 sticky top-0 z-10 grid grid-cols-[2.25rem_1fr_7rem_8.5rem_7.5rem_2.5rem] items-center gap-2 border-b px-4 py-2 text-[11px] font-medium tracking-wide uppercase backdrop-blur">
        <span>#</span>
        <span>Item</span>
        <span className="text-right">Price</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Total</span>
        <span />
      </div>
      {lines.map((line, i) => {
        const calc = byKey.get(line.key);
        const unit = unitPriceOf(line, priceMode);
        const overridden =
          line.overridePrice !== null && line.overridePrice !== listPriceOf(line, priceMode);
        const item = stockOf(line.variantId);
        const lowStock = line.trackStock && item && item.stockQty - line.qty < 0;
        const selected = line.key === selectedKey;
        return (
          <div
            key={line.key}
            ref={selected ? selectedRef : undefined}
            onClick={() => select(line.key)}
            onDoubleClick={() => onEdit(line.key)}
            className={cn(
              'grid cursor-pointer grid-cols-[2.25rem_1fr_7rem_8.5rem_7.5rem_2.5rem] items-center gap-2 border-b px-4 py-2.5 transition-colors',
              selected ? 'bg-accent/70 shadow-[inset_3px_0_0_var(--brand)]' : 'hover:bg-muted/50',
            )}
          >
            <span className="text-muted-foreground text-sm tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <p className="truncate font-medium">{line.name}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground font-mono text-[11px]">{line.sku}</span>
                {line.serialNo && (
                  <Badge variant="secondary" className="h-5 font-mono">
                    IMEI {line.serialNo}
                  </Badge>
                )}
                {!!line.warrantyDays && (
                  <Badge variant="outline" className="h-5">
                    <ShieldCheck /> {warrantyLabel(line.warrantyDays)}
                  </Badge>
                )}
                {overridden && (
                  <Badge variant="warning" className="h-5">
                    Price changed
                  </Badge>
                )}
                {line.discount && calc && calc.discountAmount > 0 && (
                  <Badge variant="success" className="h-5">
                    <Tag />
                    {line.discount.type === 'PERCENT'
                      ? `${bpToPercentText(line.discount.value)}% off`
                      : `${money(calc.discountAmount)} off`}
                  </Badge>
                )}
                {lowStock && (
                  <Badge variant="destructive" className="h-5">
                    <TriangleAlert /> Only {Math.max(0, item.stockQty)} in stock
                  </Badge>
                )}
              </div>
            </div>
            <span
              className={cn('text-right tabular-nums', overridden && 'text-warning font-medium')}
            >
              {money(unit)}
            </span>
            <div
              className="flex items-center justify-center gap-1"
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <Button
                variant="outline"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  changeQty(line.key, -1);
                }}
                disabled={line.qty <= 1 || line.trackSerial}
                aria-label="One less"
              >
                <Minus />
              </Button>
              <QtyInput
                key={line.qty}
                qty={line.qty}
                onCommit={(q) => {
                  setQty(line.key, q);
                  select(line.key);
                }}
                onDone={onQtyDone}
              />
              <Button
                variant="outline"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  changeQty(line.key, 1);
                }}
                disabled={line.trackSerial}
                aria-label="One more"
              >
                <Plus />
              </Button>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">
                {money(calc?.lineTotal ?? unit * line.qty)}
              </p>
              {calc && calc.discountAmount + calc.billDiscountShare > 0 && (
                <p className="text-muted-foreground text-xs line-through tabular-nums">
                  {money(calc.gross)}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(line.key);
              }}
              aria-label="Remove item"
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** The quantity can be typed: click it (or press * on the scan box), type, Enter. */
function QtyInput({
  qty,
  onCommit,
  onDone,
}: {
  qty: number;
  onCommit: (qty: number) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(String(qty));
  const commit = () => {
    const n = Math.floor(Number(text));
    if (Number.isFinite(n) && n >= 1 && n <= 9999 && n !== qty) onCommit(n);
    else setText(String(qty));
  };
  return (
    <input
      value={text}
      inputMode="numeric"
      aria-label="Quantity"
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 4))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          onDone();
        } else if (e.key === 'Escape') {
          setText(String(qty));
          onDone();
        }
      }}
      className="hover:border-input focus:border-ring focus:ring-ring/30 h-8 w-12 rounded-md border border-transparent bg-transparent text-center text-base font-semibold tabular-nums outline-none focus:bg-background focus:ring-2"
    />
  );
}
