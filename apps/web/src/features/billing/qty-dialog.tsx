import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCart } from '@/stores/cart';

/** "*" on the empty scan box: type how many of the selected item, Enter. */
export function QtyDialog({ lineKey, onClose }: { lineKey: string | null; onClose: () => void }) {
  const line = useCart((s) => s.lines.find((l) => l.key === lineKey));
  return (
    <Dialog open={!!lineKey && !!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xs">
        {line && (
          <QtyForm
            key={line.key}
            name={line.name}
            qty={line.qty}
            lineKey={line.key}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function QtyForm({
  name,
  qty,
  lineKey,
  onClose,
}: {
  name: string;
  qty: number;
  lineKey: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(String(qty));
  const n = Math.floor(Number(text));
  const ok = Number.isFinite(n) && n >= 1 && n <= 9999;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        useCart.getState().setQty(lineKey, n);
        onClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>Quantity</DialogTitle>
        <DialogDescription className="truncate">{name}</DialogDescription>
      </DialogHeader>
      <input
        autoFocus
        inputMode="numeric"
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 4))}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/40 h-16 rounded-lg border text-center text-4xl font-bold tabular-nums outline-none focus-visible:ring-[3px]"
        aria-label="Quantity"
      />
      <DialogFooter className="items-center">
        <span className="text-muted-foreground mr-auto text-xs">
          <kbd className="bg-muted rounded px-1.5 py-0.5">Enter</kbd> set ·{' '}
          <kbd className="bg-muted rounded px-1.5 py-0.5">Esc</kbd> cancel
        </span>
        <Button type="submit" disabled={!ok}>
          Set
        </Button>
      </DialogFooter>
    </form>
  );
}
