import { useRef, useState } from 'react';
import { Banknote, BookUser, CreditCard, Landmark, Loader2, X } from 'lucide-react';
import {
  PAYMENT_METHOD_LABELS,
  quickCashAmounts,
  summarizePayments,
  type PaymentEntry,
  type PaymentMethod,
} from '@shoppos/shared';
import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
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
  { method: 'BANK_TRANSFER', icon: Landmark, key: 'B', label: 'Bank' },
];
const CREDIT_METHOD = {
  method: 'CREDIT' as PaymentMethod,
  icon: BookUser,
  key: 'A',
  label: 'Account',
};

/** The customer on the bill, when they may buy on credit. */
export interface CreditCustomer {
  name: string;
  balance: number;
  creditLimit: number;
}

/** Marks the payment panel, so the billing keys and the scan box leave it alone while paying. */
export const PAYMENT_PANEL = '[data-payment-panel]';

/**
 * Taking payment, right under the bill total. Type the amount and press Enter. Cash can be more
 * than the bill (change). Card and cash together: choose Card, type the card amount, Enter; the
 * rest is then asked as cash. F4 = exact cash, Esc = back to the bill.
 */
export function PaymentPanel({
  total,
  credit,
  onComplete,
  onCancel,
}: {
  total: number;
  credit: CreditCustomer | null;
  /** Saves the bill. Resolves true when saved. */
  onComplete: (payments: PaymentEntry[]) => Promise<boolean>;
  onCancel: () => void;
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
  const due = summary.remaining;
  const quick = method === 'CASH' ? quickCashAmounts(due).slice(0, 4) : [];
  const focusAmount = () => setTimeout(() => amountRef.current?.select(), 0);

  async function complete(list: PaymentEntry[]) {
    setSaving(true);
    setError(null);
    const ok = await onComplete(list).catch(() => false);
    setSaving(false);
    if (!ok) focusAmount();
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
      // The rest is usually cash (e.g. part by card, the rest in cash).
      setAmount(s.remaining);
      setMethod('CASH');
      focusAmount();
    }
  }

  function exactCash() {
    if (summary.complete) void complete(entries);
    else add({ method: 'CASH', amount: due });
  }

  function choose(m: PaymentMethod) {
    setMethod(m);
    setAmount(due);
    setError(null);
    focusAmount();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (saving) return;
    const typingText = e.target instanceof HTMLInputElement && e.target.dataset.text === 'true';
    const m = METHODS.find((x) => x.key === e.key.toUpperCase());
    if (m && !e.ctrlKey && !e.metaKey && !e.altKey && !typingText) {
      e.preventDefault();
      choose(m.method);
    } else if (e.key === 'F4') {
      e.preventDefault();
      exactCash();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      add({ method, amount, reference: reference || undefined });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      data-payment-panel
      role="region"
      aria-label="Payment"
      onKeyDown={onKeyDown}
      className="animate-in fade-in slide-in-from-bottom-2 space-y-3 duration-200"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Payment</p>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground -mr-2 h-7"
          disabled={saving}
          onClick={onCancel}
        >
          <X /> Back <kbd className="text-[10px] opacity-70">Esc</kbd>
        </Button>
      </div>

      <div
        className={cn('grid gap-1.5', credit ? 'grid-cols-4' : 'grid-cols-3')}
        role="radiogroup"
        aria-label="Pay by"
      >
        {METHODS.map(({ method: m, icon: Icon, key, label }) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => choose(m)}
            disabled={saving}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-xs font-medium transition-colors',
              method === m
                ? 'border-brand bg-accent text-accent-foreground ring-brand/30 ring-2'
                : 'hover:bg-muted',
            )}
          >
            <Icon className="size-4.5" />
            {label ?? PAYMENT_METHOD_LABELS[m]}
            <kbd className="text-muted-foreground text-[9px]">{key}</kbd>
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <label className="text-muted-foreground text-xs font-medium">
          {method === 'CASH'
            ? 'Cash received'
            : `${method === 'CREDIT' ? 'On account' : PAYMENT_METHOD_LABELS[method]} amount`}
        </label>
        <MoneyInput
          ref={amountRef}
          autoFocus
          value={amount}
          onChange={setAmount}
          className="h-12 text-xl font-semibold"
          disabled={saving}
          aria-label="Amount"
        />
      </div>

      {quick.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {quick.map((q) => (
            <Button
              key={q}
              type="button"
              variant="outline"
              size="sm"
              className="px-1 text-xs"
              disabled={saving}
              onClick={() => add({ method: 'CASH', amount: q })}
            >
              {money(q)}
            </Button>
          ))}
        </div>
      )}

      {method !== 'CASH' && method !== 'CREDIT' && (
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={
            method === 'CARD' ? 'Card slip / last 4 digits (optional)' : 'Reference (optional)'
          }
          maxLength={60}
          disabled={saving}
          data-text="true"
          className="h-9 text-sm"
        />
      )}
      {method === 'CARD' && entries.length === 0 && (
        <p className="text-muted-foreground text-[11px]">
          Card and cash together: type the card amount and press Enter, then the rest in cash.
        </p>
      )}
      {method === 'CREDIT' && credit && (
        <p className="bg-muted rounded-md px-2.5 py-1.5 text-xs">
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

      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map((p, i) => (
            <li
              key={i}
              className="bg-muted/60 flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm"
            >
              <span>
                {PAYMENT_METHOD_LABELS[p.method]}
                {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
              </span>
              <span className="flex items-center gap-1.5 font-medium tabular-nums">
                {money(p.amount)}
                <button
                  type="button"
                  onClick={() => {
                    const rest = entries.filter((_, j) => j !== i);
                    setEntries(rest);
                    setAmount(summarizePayments(total, rest).remaining);
                    focusAmount();
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Remove payment"
                  disabled={saving}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{due > 0 ? 'Still to pay' : 'Change'}</span>
        <span
          className={cn('text-2xl font-bold tabular-nums', due > 0 ? 'text-brand' : 'text-success')}
        >
          {money(due > 0 ? due : summary.change)}
        </span>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 px-2"
          disabled={saving}
          onClick={exactCash}
        >
          Exact cash <kbd className="text-muted-foreground text-[10px]">F4</kbd>
        </Button>
        <Button
          type="button"
          className="h-11 px-2"
          disabled={saving}
          onClick={() =>
            summary.complete
              ? complete(entries)
              : add({ method, amount, reference: reference || undefined })
          }
        >
          {saving && <Loader2 className="animate-spin" />}
          {summary.complete || amount >= due ? 'Complete sale' : 'Add payment'}
          <kbd className="text-[10px] opacity-80">↵</kbd>
        </Button>
      </div>
    </div>
  );
}
