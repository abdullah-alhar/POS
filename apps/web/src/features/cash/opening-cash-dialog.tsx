import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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

/**
 * The cash that was in the drawer when the day started. The day starts by itself with the first
 * sale (with 0), so this is only needed to count the float.
 */
export function OpeningCashDialog({
  open,
  onClose,
  current,
}: {
  open: boolean;
  onClose: () => void;
  current: number;
}) {
  const qc = useQueryClient();
  const [cash, setCash] = useState<number>(current);
  const save = useMutation({
    mutationFn: () =>
      api.patch<CashSessionDto>('/cash-sessions/current/opening', { openingCash: cash }),
    onSuccess: (session) => {
      qc.setQueryData(cashSessionKey, { session });
      qc.invalidateQueries({ queryKey: ['cash-sessions'] });
      toast.success('Opening cash saved');
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
            if (Number.isFinite(cash) && cash >= 0) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Opening cash</DialogTitle>
            <DialogDescription>
              The cash that was in the drawer when the day started (the float).
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
              className="w-full"
              disabled={save.isPending || !Number.isFinite(cash)}
            >
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
