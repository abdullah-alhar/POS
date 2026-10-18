import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, HandCoins, Pencil, Plus, Scale, Users } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  customerInputSchema,
  LEDGER_TYPE_LABELS,
  type CustomerDto,
  type CustomerLedgerEntryDto,
  type Page,
  type SaleListItem,
} from '@shoppos/shared';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, qs } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';

const customersKey = ['customers'] as const;

export function CustomersPage() {
  const money = useMoney();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(false);
  const [type, setType] = useState<'all' | 'RETAIL' | 'WHOLESALE'>('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CustomerDto | 'new' | null>(null);
  const query = {
    q: q || undefined,
    owing: owing || undefined,
    type: type === 'all' ? undefined : type,
    page,
    pageSize: 50,
  };
  const { data, isPending } = useQuery({
    queryKey: [...customersKey, query],
    queryFn: () => api.get<Page<CustomerDto>>(`/customers${qs(query)}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Regular and wholesale customers, and what they owe the shop."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add customer
          </Button>
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value.trim());
              setPage(1);
            }}
            placeholder="Name or phone"
            className="max-w-xs"
          />
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v as typeof type);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              <SelectItem value="RETAIL">Retail</SelectItem>
              <SelectItem value="WHOLESALE">Wholesale</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={owing}
              onCheckedChange={(v) => {
                setOwing(v);
                setPage(1);
              }}
            />
            Only those who owe
          </label>
        </div>
        {!isPending && !data?.total ? (
          <EmptyState
            icon={Users}
            title="No customers"
            description="Add customers to sell on credit and track what they owe."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Credit limit</TableHead>
                <TableHead className="text-right">Owes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/customers/${c.id}`)}
                >
                  <TableCell className="font-medium">
                    {c.name}
                    {!c.isActive && (
                      <Badge variant="secondary" className="ml-2">
                        Hidden
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? '—'}</TableCell>
                  <TableCell>
                    {c.type === 'WHOLESALE' ? (
                      <Badge variant="secondary">Wholesale</Badge>
                    ) : (
                      'Retail'
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.creditLimit > 0 ? money(c.creditLimit) : 'No credit'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium tabular-nums',
                      c.balance > 0 && 'text-destructive',
                    )}
                  >
                    {money(c.balance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
      <CustomerFormDialog customer={editing} onClose={() => setEditing(null)} />
    </>
  );
}

type CustomerForm = z.input<typeof customerInputSchema>;

function CustomerFormDialog({
  customer,
  onClose,
}: {
  customer: CustomerDto | 'new' | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {customer && (
          <CustomerForm customer={customer === 'new' ? null : customer} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomerForm({ customer, onDone }: { customer: CustomerDto | null; onDone: () => void }) {
  const qc = useQueryClient();
  const form = useForm<CustomerForm>({
    resolver: zodResolver(customerInputSchema),
    defaultValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      type: customer?.type ?? 'RETAIL',
      creditLimit: customer?.creditLimit ?? 0,
      notes: customer?.notes ?? '',
      isActive: customer?.isActive ?? true,
    },
  });
  const save = useMutation({
    mutationFn: (v: CustomerForm) =>
      customer ? api.patch(`/customers/${customer.id}`, v) : api.post('/customers', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customersKey });
      qc.invalidateQueries({ queryKey: ['customer'] });
      toast.success('Customer saved');
      onDone();
    },
  });
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{customer ? `Edit ${customer.name}` : 'Add customer'}</DialogTitle>
      </DialogHeader>
      <FormField label="Name" error={e.name?.message}>
        <Input autoFocus {...form.register('name')} />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Phone">
          <Input inputMode="tel" {...form.register('phone')} />
        </FormField>
        <FormField label="Email">
          <Input type="email" {...form.register('email')} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Type">
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RETAIL">Retail (normal prices)</SelectItem>
                  <SelectItem value="WHOLESALE">Wholesale prices</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label="Credit limit (0 = no credit)" error={e.creditLimit?.message}>
          <Controller
            control={form.control}
            name="creditLimit"
            render={({ field }) => (
              <MoneyInput value={field.value ?? 0} onChange={field.onChange} />
            )}
          />
        </FormField>
      </div>
      <FormField label="Address">
        <Textarea rows={2} {...form.register('address')} />
      </FormField>
      <FormField label="Notes">
        <Textarea rows={2} {...form.register('notes')} />
      </FormField>
      {customer && (
        <label className="flex items-center gap-2 text-sm">
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
            )}
          />
          Active (hidden customers are not shown at the till)
        </label>
      )}
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const money = useMoney();
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const { data: c } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerDto>(`/customers/${id}`),
  });
  const { data: ledger } = useQuery({
    queryKey: ['customer', id, 'ledger'],
    queryFn: () =>
      api.get<Page<CustomerLedgerEntryDto>>(`/customers/${id}/ledger${qs({ pageSize: 100 })}`),
  });
  const { data: sales = [] } = useQuery({
    queryKey: ['customer', id, 'sales'],
    queryFn: () => api.get<SaleListItem[]>(`/customers/${id}/sales`),
  });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/customers">
          <ArrowLeft /> Customers
        </Link>
      </Button>
      {c && (
        <>
          <PageHeader
            title={c.name}
            description={[c.type === 'WHOLESALE' ? 'Wholesale' : 'Retail', c.phone, c.email]
              .filter(Boolean)
              .join(' · ')}
            actions={
              <>
                {can('customers.credit') && (
                  <Button onClick={() => setPaying(true)}>
                    <HandCoins /> Receive payment
                  </Button>
                )}
                {can('users.manage') && (
                  <Button variant="outline" onClick={() => setAdjusting(true)}>
                    <Scale /> Adjust balance
                  </Button>
                )}
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
              </>
            }
          />
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <Stat
              label="Owes the shop"
              value={money(c.balance)}
              tone={c.balance > 0 ? 'bad' : undefined}
            />
            <Stat
              label="Credit limit"
              value={c.creditLimit > 0 ? money(c.creditLimit) : 'No credit'}
            />
            <Stat
              label="Can still buy on credit"
              value={c.creditLimit > 0 ? money(Math.max(0, c.creditLimit - c.balance)) : '—'}
            />
          </div>
        </>
      )}
      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">Account</TabsTrigger>
          <TabsTrigger value="sales">Bills ({sales.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger">
          <Card className="py-0">
            {!ledger?.items.length ? (
              <EmptyState icon={HandCoins} title="No credit sales or payments yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.items.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(l.createdAt).toLocaleString()}
                        <span className="block text-xs">{l.userName}</span>
                      </TableCell>
                      <TableCell>{LEDGER_TYPE_LABELS[l.type] ?? l.type}</TableCell>
                      <TableCell className="text-muted-foreground max-w-72 text-sm whitespace-normal">
                        {[l.reference, l.method?.replace('_', ' ').toLowerCase(), l.note]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell
                        className={cn('text-right tabular-nums', l.amount < 0 && 'text-success')}
                      >
                        {l.amount > 0 ? '+' : ''}
                        {money(l.amount)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(l.balanceAfter)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="sales">
          <Card className="py-0">
            {!sales.length ? (
              <EmptyState icon={Users} title="No bills for this customer yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Paid by</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((s) => (
                    <TableRow key={s.id} className={cn(s.status === 'VOIDED' && 'opacity-50')}>
                      <TableCell className="font-mono text-sm">
                        {s.number}
                        {s.status === 'VOIDED' && (
                          <Badge variant="destructive" className="ml-2">
                            Voided
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(s.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.methods.map((m) => m.replace('_', ' ').toLowerCase()).join(', ')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.itemCount}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(s.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
      {c && (
        <>
          <CustomerFormDialog customer={editing ? c : null} onClose={() => setEditing(false)} />
          <Dialog open={paying} onOpenChange={setPaying}>
            <DialogContent className="sm:max-w-sm">
              {paying && <PaymentForm customer={c} onDone={() => setPaying(false)} />}
            </DialogContent>
          </Dialog>
          <Dialog open={adjusting} onOpenChange={setAdjusting}>
            <DialogContent className="sm:max-w-sm">
              {adjusting && <AdjustForm customer={c} onDone={() => setAdjusting(false)} />}
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-muted-foreground text-sm font-normal">{label}</CardTitle>
      </CardHeader>
      <CardContent
        className={cn('px-4 text-2xl font-bold tabular-nums', tone === 'bad' && 'text-destructive')}
      >
        {value}
      </CardContent>
    </Card>
  );
}

function useRefreshCustomer(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['customer', id] });
    qc.invalidateQueries({ queryKey: customersKey });
    qc.invalidateQueries({ queryKey: ['cash-session'] });
  };
}

function PaymentForm({ customer, onDone }: { customer: CustomerDto; onDone: () => void }) {
  const money = useMoney();
  const refresh = useRefreshCustomer(customer.id);
  const [amount, setAmount] = useState<number>(Math.max(customer.balance, 0));
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER'>('CASH');
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: () =>
      api.post(`/customers/${customer.id}/payments`, {
        amount,
        method,
        reference: reference || undefined,
      }),
    onSuccess: () => {
      refresh();
      toast.success(`Payment of ${money(amount)} recorded`);
      onDone();
    },
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount > 0) pay.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Payment from {customer.name}</DialogTitle>
        <DialogDescription>
          Owes {money(customer.balance)}. Cash payments go into today&apos;s drawer.
        </DialogDescription>
      </DialogHeader>
      <FormField label="Amount">
        <MoneyInput autoFocus value={amount} onChange={setAmount} />
      </FormField>
      <FormField label="Paid by">
        <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="CARD">Card</SelectItem>
            <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      {method !== 'CASH' && (
        <FormField label="Reference (optional)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormField>
      )}
      <DialogFooter>
        <Button type="submit" disabled={!(amount > 0) || pay.isPending}>
          Record payment
        </Button>
      </DialogFooter>
    </form>
  );
}

function AdjustForm({ customer, onDone }: { customer: CustomerDto; onDone: () => void }) {
  const money = useMoney();
  const refresh = useRefreshCustomer(customer.id);
  const [direction, setDirection] = useState<'more' | 'less'>('more');
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/customers/${customer.id}/adjust`, {
        amount: direction === 'more' ? amount : -amount,
        note,
      }),
    onSuccess: () => {
      refresh();
      toast.success('Balance adjusted');
      onDone();
    },
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount > 0 && note.trim().length >= 3) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Adjust balance</DialogTitle>
        <DialogDescription>
          Now owes {money(customer.balance)}. Use this for old balances from before the POS, or
          corrections.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2">
        {(['more', 'less'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={cn(
              'rounded-lg border p-2.5 text-sm font-medium',
              direction === d ? 'border-brand bg-accent ring-brand/30 ring-2' : 'hover:bg-muted',
            )}
          >
            {d === 'more' ? 'Owes more' : 'Owes less'}
          </button>
        ))}
      </div>
      <FormField label="Amount">
        <MoneyInput autoFocus value={amount} onChange={setAmount} />
      </FormField>
      <FormField label="Why?">
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Balance from the old book"
        />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={!(amount > 0) || note.trim().length < 3 || save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
