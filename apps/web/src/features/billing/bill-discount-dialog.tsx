import { useState } from 'react';
import type { Discount } from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePublicSettings } from '@/lib/queries';
import { useCart } from '@/stores/cart';
import { DiscountEditor } from './discount-editor';

/** Discount on the whole bill (F8). It is shared out over the items in proportion. */
export function BillDiscountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {open && <BillDiscountForm onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function BillDiscountForm({ onClose }: { onClose: () => void }) {
  const current = useCart((s) => s.billDiscount);
  const setBillDiscount = useCart((s) => s.setBillDiscount);
  const { data: settings } = usePublicSettings();
  const [value, setValue] = useState<Discount | null>(current);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBillDiscount(value);
        onClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>Bill discount</DialogTitle>
        <DialogDescription>
          Applies after item discounts. Cashiers can give up to{' '}
          {(settings?.approvals.cashierMaxDiscountBp ?? 1000) / 100}% in total without admin
          approval.
        </DialogDescription>
      </DialogHeader>
      <DiscountEditor value={value} onChange={setValue} autoFocus />
      <DialogFooter>
        {current && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setBillDiscount(null);
              onClose();
            }}
          >
            Remove discount
          </Button>
        )}
        <Button type="submit">Apply</Button>
      </DialogFooter>
    </form>
  );
}
