import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { warrantyLabel, type PosIndexItem } from '@marina/shared';
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

/** Items with a serial number / IMEI: scan the IMEI barcode on the box, or type it. */
export function SerialDialog({
  item,
  onDone,
}: {
  item: PosIndexItem | null;
  onDone: (serial: string | null) => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent className="sm:max-w-md">
        {item && <SerialForm key={item.variantId} item={item} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function SerialForm({
  item,
  onDone,
}: {
  item: PosIndexItem;
  onDone: (serial: string | null) => void;
}) {
  const [serial, setSerial] = useState('');
  const clean = serial.trim();
  const onBill = useCart((s) =>
    s.lines.some((l) => l.serialNo?.toUpperCase() === clean.toUpperCase() && !!clean),
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean && !onBill) onDone(clean);
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Smartphone className="size-5" /> Serial number / IMEI
        </DialogTitle>
        <DialogDescription>
          {item.name}
          {item.warrantyDays > 0 && ` · warranty ${warrantyLabel(item.warrantyDays)}`}
        </DialogDescription>
      </DialogHeader>
      <input
        autoFocus
        value={serial}
        onChange={(e) => setSerial(e.target.value.replace(/\s+/g, '').slice(0, 60))}
        placeholder="Scan or type the IMEI / serial number"
        className="border-input focus-visible:border-ring focus-visible:ring-ring/40 h-12 rounded-lg border px-4 font-mono text-lg outline-none focus-visible:ring-[3px]"
        aria-label="Serial number or IMEI"
      />
      {onBill && <p className="text-destructive text-sm">This number is already on the bill.</p>}
      {/^\d{15}$/.test(clean) && (
        <p className="text-muted-foreground text-xs">15 digits: looks like an IMEI.</p>
      )}
      <DialogFooter className="items-center">
        <span className="text-muted-foreground mr-auto text-xs">
          <kbd className="bg-muted rounded px-1.5 py-0.5">Enter</kbd> add ·{' '}
          <kbd className="bg-muted rounded px-1.5 py-0.5">Esc</kbd> cancel
        </span>
        <Button type="submit" disabled={!clean || onBill}>
          Add to bill
        </Button>
      </DialogFooter>
    </form>
  );
}
