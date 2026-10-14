import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXPENSE_PAID_FROM,
  EXPENSE_PAID_FROM_LABELS,
  type ExpenseDto,
  type ExpensePaidFrom,
  type Page,
} from '@marina/shared';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, qs } from '@/lib/api';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';

const expensesKey = ['expenses'] as const;

function localDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
function monthStart() {
  const d = new Date();
  return localDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

const useCategories = () =>
  useQuery({
    queryKey: [...expensesKey, 'categories'],
    queryFn: () => api.get<string[]>('/expenses/categories'),
  });

export function ExpensesPage() {
  const money = useMoney();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDate());
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<ExpenseDto | null>(null);
  const { data: categories = [] } = useCategories();
  const query = {
    from: from || undefined,
    to: to || undefined,
    category: category === 'all' ? undefined : category,
    page,
    pageSize: 50,
  };
  const { data, isPending } = useQuery({
    queryKey: [...expensesKey, query],
    queryFn: () => api.get<Page<ExpenseDto> & { totalAmount: number }>(`/expenses${qs(query)}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Rent, bills, salaries and other shop costs. They are taken off the profit in reports."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add expense
          </Button>
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-end gap-3 border-b p-3">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">From</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => (setFrom(e.target.value), setPage(1))}
              className="w-40"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">To</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => (setTo(e.target.value), setPage(1))}
              className="w-40"
            />
          </label>
          <Select value={category} onValueChange={(v) => (setCategory(v), setPage(1))}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto text-right">
            <p className="text-muted-foreground text-xs">Total</p>
            <p className="text-xl font-bold tabular-nums">{money(data?.totalAmount ?? 0)}</p>
          </div>
        </div>
        {!isPending && !data?.total ? (
          <EmptyState icon={Wallet} title="No expenses in these dates" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Paid from</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((x) => (
                <TableRow key={x.id} className={cn(x.cancelledAt && 'opacity-50')}>
                  <TableCell>
                    {new Date(`${x.date.slice(0, 10)}T00:00`).toLocaleDateString()}
                    <span className="text-muted-foreground block font-mono text-xs">
                      {x.number}
                    </span>
                  </TableCell>
                  <TableCell>{x.category}</TableCell>
                  <TableCell className="text-sm">{EXPENSE_PAID_FROM_LABELS[x.paidFrom]}</TableCell>
                  <TableCell className="text-muted-foreground max-w-72 text-sm whitespace-normal">
                    {x.note ?? '—'}
                    <span className="block text-xs">{x.userName}</span>
                    {x.cancelledAt && (
                      <Badge variant="destructive">Cancelled: {x.cancelReason}</Badge>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium tabular-nums',
                      x.cancelledAt && 'line-through',
                    )}
                  >
                    {money(x.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {!x.cancelledAt && (
                      <Button variant="ghost" size="sm" onClick={() => setCancelling(x)}>
                        <Ban /> Cancel
                      </Button>
                    )}
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
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          {adding && <ExpenseForm categories={categories} onDone={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent className="sm:max-w-sm">
          {cancelling && <CancelForm expense={cancelling} onDone={() => setCancelling(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExpenseForm({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(localDate());
  const [category, setCategory] = useState('');
  const [custom, setCustom] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [paidFrom, setPaidFrom] = useState<ExpensePaidFrom>('DRAWER');
  const [note, setNote] = useState('');
  const finalCategory = category === '__new' ? custom.trim() : category;
  const save = useMutation({
    mutationFn: () =>
      api.post<ExpenseDto>('/expenses', {
        date,
        category: finalCategory,
        amount,
        paidFrom,
        note: note || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expensesKey });
      qc.invalidateQueries({ queryKey: ['cash-session'] });
      toast.success('Expense saved');
      onDone();
    },
  });
  const ok = amount > 0 && !!finalCategory && !!date;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add expense</DialogTitle>
        <DialogDescription>
          Cash from the drawer is taken off the cash the drawer should have today.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Date">
          <Input
            type="date"
            value={date}
            max={localDate()}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
        <FormField label="Amount">
          <MoneyInput autoFocus value={amount} onChange={setAmount} />
        </FormField>
      </div>
      <FormField label="Category">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
            <SelectItem value="__new">New category…</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      {category === '__new' && (
        <FormField label="New category name">
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} />
        </FormField>
      )}
      <FormField label="Paid from">
        <div className="grid gap-2 sm:grid-cols-3">
          {EXPENSE_PAID_FROM.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPaidFrom(p)}
              className={cn(
                'rounded-lg border p-2 text-sm font-medium',
                paidFrom === p ? 'border-brand bg-accent ring-brand/30 ring-2' : 'hover:bg-muted',
              )}
            >
              {EXPENSE_PAID_FROM_LABELS[p]}
            </button>
          ))}
        </div>
      </FormField>
      <FormField label="Note (optional)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={!ok || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function CancelForm({ expense, onDone }: { expense: ExpenseDto; onDone: () => void }) {
  const qc = useQueryClient();
  const money = useMoney();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.post(`/expenses/${expense.id}/cancel`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expensesKey });
      qc.invalidateQueries({ queryKey: ['cash-session'] });
      toast.success('Expense cancelled');
      onDone();
    },
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 3) cancel.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Cancel {expense.number}?</DialogTitle>
        <DialogDescription>
          {expense.category}, {money(expense.amount)}. It stays in the list, marked cancelled.
        </DialogDescription>
      </DialogHeader>
      <FormField label="Why?">
        <Input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Entered twice"
        />
      </FormField>
      <DialogFooter>
        <Button
          type="submit"
          variant="destructive"
          disabled={reason.trim().length < 3 || cancel.isPending}
        >
          Cancel expense
        </Button>
      </DialogFooter>
    </form>
  );
}
