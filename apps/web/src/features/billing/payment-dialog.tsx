import { useRef, useState } from 'react';
import { Banknote, BookUser, CreditCard, Landmark, Loader2, X } from 'lucide-react';
import {
  PAYMENT_METHOD_LABELS,
  quickCashAmounts,
  summarizePayments,
  type PaymentEntry,
  type PaymentMethod,
} from '@marina/shared';
import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';

const BASE_METHODS: {
  method: PaymentMethod;
  icon: typeof Banknote;
  key: string;
  label?: string;
}[] = [
  { method: 'CASH', icon: Banknote, key: 'C' },
  { method: 'CARD', icon: CreditCard, key: 'K' },
  { method: 'BANK_TRANSFER', icon: Landmark, key: 'B' },
];
const CREDIT_METHOD = {
  method: 'CREDIT' as PaymentMethod,
  icon: BookUser,
  key: 'A',
  label: 'On account',
};

/** The customer on the bill, when they may buy on credit. */
export interface CreditCustomer {
  name: string;
  balance: number;
  creditLimit: number;
}

/**
 * Take payment. Type the amount and press Enter. Cash can be more than the bill (change);
 * pay part by card and the rest in cash for a split payment. F4 = exact cash.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  total,
  credit,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  credit?: CreditCustomer | null;
  /** Saves the bill. Resolves true when saved. */
  onComplete: (payments: PaymentEntry[]) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        {open && <PaymentForm total={total} credit={credit ?? null} onComplete={onComplete} />}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  total,
  credit,
  onComplete,
}: {
  total: number;
  credit: CreditCustomer | null;
  onComplete: (p: PaymentEntry[]) => Promise<boolean>;
}) {
  const money = useMoney();
  const METHODS = credit ? [...BASE_METHODS, CREDIT_METHOD] : BASE_METHODS;
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState<number>(total);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const summary = summarizePayments(total, entries);

  async function complete(list: PaymentEntry[]) {
    setSaving(true);
    setError(null);
    const ok = await onComplete(list).catch(() => false);
    setSaving(false);
    if (!ok) setTimeout(() => amountRef.current?.focus(), 0);
  }

  function add(entry: PaymentEntry) {
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) {
      if (summary.complete) void complete(entries);
      else setError('Enter the amount');
      return;
    }
    const next = [...entries, entry];
    const s = summarizePayments(total, next);
    if (s.error) {
      setError(s.error);
      return;
    }
    setError(null);
    setEntries(next);
    setReference('');
    if (s.complete) void complete(next);
    else {
      setAmount(s.remaining);
      setMethod('CASH');
      setTimeout(() => amountRef.current?.select(), 0);
    }
  }

  function exactCash() {
    const s = summarizePayments(total, entries);
    if (s.complete) void complete(entries);
    else add({ method: 'CASH', amount: s.remaining });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (saving) return;
    const k = e.key.toUpperCase();
    const m = METHODS.find((x) => x.key === k);
    const typingText = e.target instanceof HTMLInputElement && e.target.dataset.text === 'true';
    if (m && !e.ctrlKey && !e.metaKey && !typingText) {
      e.preventDefault();
      setMethod(m.method);
      return;
    }
    if (e.key === 'F4') {
      e.preventDefault();
      exactCash();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      add({ method, amount, reference: reference || undefined });
    }
  }

  const due = summary.remaining;
  const quick = method === 'CASH' ? quickCashAmounts(due) : [];

  return (
    <div className="grid md:grid-cols-[1fr_1.15fr]" onKeyDown={onKeyDown}>
      <div className="bg-muted/40 flex flex-col gap-4 border-r p-6">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            Enter = add payment · F4 = exact cash · C / K / B{credit ? ' / A' : ''} = cash, card,
            bank
            {credit ? ', on account' : ''}
          </DialogDescription>
        </DialogHeader>
        <div>
          <p className="text-muted-foreground text-sm">Bill total</p>
          <p className="text-4xl font-bold tabular-nums">{money(total)}</p>
        </div>
        <ul className="space-y-1.5">
          {entries.map((p, i) => (
            <li
              key={i}
              className="bg-card flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>
                {PAYMENT_METHOD_LABELS[p.method]}
                {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
              </span>
              <span className="flex items-center gap-2 font-medium tabular-nums">
                {money(p.amount)}
                <button
                  type="button"
                  onClick={() => setEntries(entries.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Remove payment"
                  disabled={saving}
                >
                  <X className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-auto space-y-1 border-t pt-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Paid</span>
            <span className="tabular-nums">{money(summary.nonCash + summary.cashTendered)}</span>
          </div>
          {due > 0 ? (
            <div className="flex justify-between text-lg font-semibold">
              <span>Still to pay</span>
              <span className="text-brand tabular-nums">{money(due)}</span>
            </div>
          ) : (
            <div className="flex justify-between text-lg font-semibold">
              <span>Change</span>
              <span className="text-success tabular-nums">{money(summary.change)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-6">
        <div className={cn('grid gap-2', credit ? 'grid-cols-4' : 'grid-cols-3')}>
          {METHODS.map(({ method: m, icon: Icon, key, label }) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMethod(m);
                amountRef.current?.focus();
              }}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border p-3 text-sm font-medium transition-colors',
                method === m
                  ? 'border-brand bg-accent text-accent-foreground ring-brand/30 ring-2'
                  : 'hover:bg-muted',
              )}
            >
              <Icon className="size-5" />
              {label ?? PAYMENT_METHOD_LABELS[m]}
              <kbd className="text-muted-foreground text-[10px]">{key}</kbd>
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {method === 'CASH' ? 'Cash received' : 'Amount'}
          </label>
          <MoneyInput
            ref={amountRef}
            autoFocus
            value={amount}
            onChange={setAmount}
            className="h-14 text-2xl font-semibold"
            disabled={saving}
          />
        </div>

        {quick.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {quick.map((q) => (
              <Button
                key={q}
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => add({ method: 'CASH', amount: q })}
              >
                {money(q)}
              </Button>
            ))}
          </div>
        )}

        {method === 'CREDIT' && credit && (
          <p className="bg-muted rounded-md px-3 py-2 text-sm">
            {credit.name} owes <span className="font-medium">{money(credit.balance)}</span>
            {credit.creditLimit > 0 ? (
              <>
                {' '}
                · limit <span className="font-medium">{money(credit.creditLimit)}</span>
              </>
            ) : (
              ' · no credit limit set (needs admin approval)'
            )}
          </p>
        )}

        {method !== 'CASH' && method !== 'CREDIT' && (
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={
              method === 'CARD'
                ? 'Card slip / last 4 digits (optional)'
                : 'Transfer reference (optional)'
            }
            maxLength={60}
            disabled={saving}
            data-text="true"
          />
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="mt-auto grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="lg" disabled={saving} onClick={exactCash}>
            Exact cash <kbd className="text-muted-foreground ml-1 text-xs">F4</kbd>
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={saving}
            onClick={() =>
              summary.complete
                ? complete(entries)
                : add({ method, amount, reference: reference || undefined })
            }
          >
            {saving && <Loader2 className="animate-spin" />}
            {summary.complete ? 'Complete sale' : 'Add payment'}{' '}
            <kbd className="ml-1 text-xs opacity-80">Enter</kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}
