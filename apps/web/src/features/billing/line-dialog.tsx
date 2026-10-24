import { useState } from 'react';
import { Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { calculateCart, type Discount } from '@shoppos/shared';
import { FormField } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMoney, usePublicSettings } from '@/lib/queries';
import { listPriceOf, useCart, type CartLine } from '@/stores/cart';
import { DiscountEditor } from './discount-editor';

/** Change quantity, price or discount of one line (Ctrl+D, or double-click the line). */
export function LineDialog({ lineKey, onClose }: { lineKey: string | null; onClose: () => void }) {
  const line = useCart((s) => s.lines.find((l) => l.key === lineKey));
  return (
    <Dialog open={!!line} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {line && <LineForm line={line} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function LineForm({ line, onClose }: { line: CartLine; onClose: () => void }) {
  const money = useMoney();
  const { data: settings } = usePublicSettings();
  const priceMode = useCart((s) => s.priceMode);
  const updateLine = useCart((s) => s.updateLine);
  const remove = useCart((s) => s.remove);
  const list = listPriceOf(line, priceMode);

  const [qty, setQty] = useState(String(line.qty));
  const [price, setPrice] = useState<number>(line.overridePrice ?? list);
  const [discount, setDiscount] = useState<Discount | null>(line.discount);

  const qtyNum = Number(qty);
  const qtyOk = Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 100_000;
  const priceOk = Number.isFinite(price) && price >= 0;
  const preview =
    qtyOk && priceOk
      ? calculateCart([{ key: 'x', unitPrice: price, qty: qtyNum, discount, taxRateBp: 0 }], null, {
          pricesIncludeTax: true,
          roundingStep: settings?.pos.roundingStep ?? 100,
        }).lines[0]
      : null;
  const limitBp = settings?.approvals.cashierMaxDiscountBp ?? 1000;

  function save() {
    if (!qtyOk || !priceOk) return;
    updateLine(line.key, {
      qty: qtyNum,
      overridePrice: price === list ? null : price,
      discount,
    });
    onClose();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle className="pr-6 leading-snug">{line.name}</DialogTitle>
        <DialogDescription>
          {line.sku} · normal price {money(list)}
        </DialogDescription>
      </DialogHeader>
      <FormField label="Quantity" error={qtyOk ? undefined : 'Enter a whole number of at least 1'}>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setQty(String(Math.max(1, (qtyNum || 1) - 1)))}
          >
            <Minus />
          </Button>
          <Input
            autoFocus
            inputMode="numeric"
            value={qty}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
            className="text-center text-lg font-semibold"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setQty(String((qtyNum || 0) + 1))}
          >
            <Plus />
          </Button>
        </div>
      </FormField>
      <FormField
        label="Price for one"
        hint={
          price !== list ? 'Changed price: a cashier needs admin approval at payment' : undefined
        }
      >
        <div className="flex gap-2">
          <MoneyInput value={price} onChange={setPrice} className="flex-1" />
          {price !== list && (
            <Button type="button" variant="ghost" onClick={() => setPrice(list)}>
              <RotateCcw /> Normal
            </Button>
          )}
        </div>
      </FormField>
      <FormField
        label="Discount"
        hint={`Cashiers can give up to ${limitBp / 100}% without approval`}
      >
        <DiscountEditor value={discount} onChange={setDiscount} />
      </FormField>
      {preview && (
        <div className="bg-muted flex items-center justify-between rounded-lg px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {preview.discountAmount > 0 && `Discount ${money(preview.discountAmount)} · `}Line total
          </span>
          <span className="text-base font-semibold tabular-nums">{money(preview.lineTotal)}</span>
        </div>
      )}
      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          onClick={() => {
            remove(line.key);
            onClose();
          }}
        >
          <Trash2 /> Remove item
        </Button>
        <Button type="submit" disabled={!qtyOk || !priceOk}>
          Save <kbd className="ml-1 text-xs opacity-80">Enter</kbd>
        </Button>
      </DialogFooter>
    </form>
  );
}
