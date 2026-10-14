import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Loader2, PauseCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerDto, HeldBillDto } from '@marina/shared';
import { EmptyState } from '@/components/empty-state';
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
import { api } from '@/lib/api';
import { usePublicSettings } from '@/lib/queries';
import { useCart } from '@/stores/cart';
import { toCartCustomer } from './customer-dialog';
import type { PosCatalog } from './use-pos-index';

export const heldBillsKey = ['held-bills'] as const;

export function useHeldBills() {
  return useQuery({ queryKey: heldBillsKey, queryFn: () => api.get<HeldBillDto[]>('/held-bills') });
}

/** F6: park the current bill with an optional name ("blue shirt", "Kamal"). */
export function HoldDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const [label, setLabel] = useState('');
  const hold = useMutation({
    mutationFn: () =>
      api.post<HeldBillDto>('/held-bills', {
        label: label || undefined,
        cart: useCart.getState().toHeld(),
      }),
    onSuccess: () => {
      useCart.getState().reset(settings?.pos.defaultPriceMode ?? 'RETAIL');
      qc.invalidateQueries({ queryKey: heldBillsKey });
      toast.success('Bill held. Recall it with F7.');
      setLabel('');
      onClose();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            hold.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Hold this bill</DialogTitle>
            <DialogDescription>
              Serve the next customer, then bring this bill back with F7.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name or note (optional)"
            maxLength={60}
          />
          <DialogFooter>
            <Button type="submit" disabled={hold.isPending}>
              {hold.isPending ? <Loader2 className="animate-spin" /> : <PauseCircle />} Hold bill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** F7: bring back a held bill. */
export function RecallDialog({
  open,
  onClose,
  catalog,
}: {
  open: boolean;
  onClose: () => void;
  catalog: PosCatalog | null;
}) {
  const qc = useQueryClient();
  const { data: held = [], isPending } = useHeldBills();
  const recall = useMutation({
    mutationFn: (id: string) => api.post<HeldBillDto>(`/held-bills/${id}/recall`),
    onSuccess: (bill) => {
      const missing = useCart
        .getState()
        .loadHeld(bill.cart, (id) => catalog?.items.find((i) => i.variantId === id));
      if (missing.length) toast.warning(`No longer for sale, left out: ${missing.join(', ')}`);
      if (bill.cart.customerId) {
        api
          .get<CustomerDto>(`/customers/${bill.cart.customerId}`)
          .then((c) => useCart.getState().setCustomer(toCartCustomer(c)))
          .catch(() => toast.warning('The customer on this bill could not be loaded'));
      }
      qc.invalidateQueries({ queryKey: heldBillsKey });
      onClose();
    },
  });
  const discard = useMutation({
    mutationFn: (id: string) => api.delete(`/held-bills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: heldBillsKey }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Held bills</DialogTitle>
          <DialogDescription>Pick a bill to continue it.</DialogDescription>
        </DialogHeader>
        {!isPending && held.length === 0 ? (
          <EmptyState icon={Inbox} title="No held bills" />
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-lg border">
            {held.map((h, i) => (
              <li key={h.id} className="flex items-center gap-3 p-3">
                <span className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{h.label || `${h.itemCount} item(s)`}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {new Date(h.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {h.user.fullName} · {h.cart.lines.map((l) => l.name).join(', ')}
                  </p>
                </div>
                <Button size="sm" onClick={() => recall.mutate(h.id)} disabled={recall.isPending}>
                  Recall
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => discard.mutate(h.id)}
                  disabled={discard.isPending}
                  aria-label="Discard held bill"
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
