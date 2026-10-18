import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sunrise } from 'lucide-react';
import { toast } from 'sonner';
import type { CashSessionDto } from '@shoppos/shared';
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
import { api } from '@/lib/api';

export const cashSessionKey = ['cash-session', 'current'] as const;

/** Start of the day: count the cash in the drawer. Selling needs an open day. */
export function OpenDayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [cash, setCash] = useState<number>(0);
  const openDay = useMutation({
    mutationFn: () => api.post<CashSessionDto>('/cash-sessions/open', { openingCash: cash }),
    onSuccess: (session) => {
      qc.setQueryData(cashSessionKey, { session });
      toast.success('The day is open. Happy selling!');
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
            if (Number.isFinite(cash) && cash >= 0) openDay.mutate();
          }}
        >
          <DialogHeader className="items-center text-center">
            <div className="bg-accent text-accent-foreground mb-1 flex size-12 items-center justify-center rounded-full">
              <Sunrise className="size-6" />
            </div>
            <DialogTitle>Open the day</DialogTitle>
            <DialogDescription>
              Count the cash in the drawer before the first sale.
            </DialogDescription>
          </DialogHeader>
          <MoneyInput
            autoFocus
            value={cash}
            onChange={setCash}
            className="h-12 text-xl font-semibold"
          />
          <DialogFooter>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={openDay.isPending || !Number.isFinite(cash)}
            >
              {openDay.isPending && <Loader2 className="animate-spin" />} Open the day
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
