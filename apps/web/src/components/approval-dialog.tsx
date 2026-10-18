import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { APPROVAL_ACTIONS, type ApprovalAction, type ApprovalResult } from '@shoppos/shared';
import { PinPad } from '@/components/pin-pad';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError, setApprovalHandler } from '@/lib/api';

interface Pending {
  action: ApprovalAction;
  message: string;
  resolve: (token: string | null) => void;
}

/**
 * Mounted once. When any API call answers "admin approval needed", this asks an admin for their
 * PIN and the original request is sent again with the approval token.
 */
export function ApprovalDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<Pending | null>(null);

  useEffect(() => {
    setApprovalHandler(
      (action, message) =>
        new Promise((resolve) => {
          pendingRef.current?.resolve(null);
          const next = { action, message, resolve };
          pendingRef.current = next;
          setPin('');
          setError('');
          setPending(next);
        }),
    );
    return () => setApprovalHandler(null);
  }, []);

  function close(token: string | null) {
    pendingRef.current?.resolve(token);
    pendingRef.current = null;
    setPending(null);
    setPin('');
  }

  async function submit(value: string) {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post<ApprovalResult>(
        '/auth/approve',
        { action: pending.action, pin: value },
        { noApproval: true },
      );
      close(result.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check the PIN');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <div className="bg-primary/10 text-primary mb-1 flex size-12 items-center justify-center rounded-full">
            <ShieldCheck className="size-6" />
          </div>
          <DialogTitle>Admin approval needed</DialogTitle>
          <DialogDescription>
            {pending && APPROVAL_ACTIONS[pending.action]}. Ask the owner to enter their PIN.
          </DialogDescription>
        </DialogHeader>
        <PinPad value={pin} onChange={setPin} onSubmit={submit} disabled={busy} error={error} />
      </DialogContent>
    </Dialog>
  );
}
