import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Search, UserPlus } from 'lucide-react';
import type { CustomerDto, Page } from '@shoppos/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useCart, type CartCustomer } from '@/stores/cart';

export function toCartCustomer(c: CustomerDto): CartCustomer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    type: c.type,
    balance: c.balance,
    creditLimit: c.creditLimit,
  };
}

/** F3: find the customer by name or phone, or add a new one quickly. */
export function CustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {open && <CustomerPicker onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CustomerPicker({ onClose }: { onClose: () => void }) {
  const money = useMoney();
  const can = useCan();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newType, setNewType] = useState<'RETAIL' | 'WHOLESALE'>('RETAIL');

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);

  const { data, isFetching } = useQuery({
    queryKey: ['customers', 'pick', q],
    queryFn: () =>
      api.get<Page<CustomerDto>>(`/customers${qs({ q: q || undefined, pageSize: 8 })}`),
  });
  const list = data?.items ?? [];

  function choose(c: CustomerDto) {
    useCart.getState().setCustomer(toCartCustomer(c));
    onClose();
  }

  const create = useMutation({
    mutationFn: () =>
      api.post<CustomerDto>('/customers', {
        name: newName,
        phone: newPhone || undefined,
        type: newType,
      }),
    onSuccess: choose,
  });

  if (adding) {
    return (
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate();
        }}
      >
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Input
          placeholder="Phone (optional)"
          inputMode="tel"
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          {(['RETAIL', 'WHOLESALE'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setNewType(t)}
              className={cn(
                'rounded-lg border p-2.5 text-sm font-medium',
                newType === t ? 'border-brand bg-accent ring-brand/30 ring-2' : 'hover:bg-muted',
              )}
            >
              {t === 'RETAIL' ? 'Retail customer' : 'Wholesale customer'}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          A credit limit can be set later on the Customers page.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            Back
          </Button>
          <Button type="submit" disabled={!newName.trim() || create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Add and use
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid gap-3">
      <DialogHeader>
        <DialogTitle>Customer</DialogTitle>
        <DialogDescription>Search by name or phone number.</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (list.length)
                setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
            } else if (e.key === 'Enter' && list[active]) {
              e.preventDefault();
              choose(list[active]);
            }
          }}
          placeholder="Name or phone"
          className="h-11 pl-9"
        />
        {isFetching && (
          <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
        )}
      </div>
      <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
        {list.length === 0 && (
          <li className="text-muted-foreground p-4 text-sm">No customers found.</li>
        )}
        {list.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2.5 text-left',
                i === active && 'bg-accent',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="text-muted-foreground text-xs">{c.phone ?? 'No phone'}</span>
              </span>
              {c.type === 'WHOLESALE' && <Badge variant="secondary">Wholesale</Badge>}
              {c.balance > 0 && <Badge variant="warning">Owes {money(c.balance)}</Badge>}
            </button>
          </li>
        ))}
      </ul>
      {can('customers.manage') && (
        <Button
          variant="outline"
          onClick={() => {
            setAdding(true);
            setNewName(/^[\d\s+-]+$/.test(text) ? '' : text);
            setNewPhone(/^[\d\s+-]+$/.test(text) ? text : '');
          }}
        >
          <UserPlus /> New customer
        </Button>
      )}
    </div>
  );
}

export function CustomerChip({ onPick }: { onPick: () => void }) {
  const customer = useCart((s) => s.customer);
  const money = useMoney();
  if (!customer) {
    return (
      <Button variant="outline" className="h-12 shrink-0" onClick={onPick}>
        <Plus /> Customer <kbd className="text-muted-foreground ml-1 text-[11px]">F3</kbd>
      </Button>
    );
  }
  return (
    <div className="bg-accent text-accent-foreground flex h-12 max-w-64 shrink-0 items-center gap-2 rounded-lg border pr-1 pl-3">
      <button type="button" onClick={onPick} className="min-w-0 text-left">
        <span className="block truncate text-sm leading-tight font-semibold">{customer.name}</span>
        <span className="block text-[11px] leading-tight opacity-80">
          {customer.type === 'WHOLESALE' ? 'Wholesale' : 'Retail'}
          {customer.balance > 0 && ` · owes ${money(customer.balance)}`}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => useCart.getState().setCustomer(null)}
        aria-label="Remove customer"
      >
        ×
      </Button>
    </div>
  );
}
