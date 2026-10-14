import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Moon,
  Printer,
  Sunrise,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  LKR_DENOMINATIONS,
  type CashSessionDto,
  type CashSessionSummary,
  type Page,
} from '@marina/shared';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, qs } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useBranding } from '@/lib/branding';
import { useMoney, usePublicSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { cashSessionKey, OpenDayDialog } from '../billing/open-day-dialog';
import { printReceipt } from '../receipts/print';

const summaryKey = ['cash-session', 'summary'] as const;

function usePrintDay() {
  const { data: settings } = usePublicSettings();
  const branding = useBranding();
  return (id: string) =>
    printReceipt(id, {
      mode: settings?.printer.mode ?? 'browser',
      kind: 'cash-sessions',
      logo: branding.logo,
    }).catch((err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not print the day report'),
    );
}

export function CashPage() {
  const can = useCan();
  const money = useMoney();
  const [opening, setOpening] = useState(false);
  const [movement, setMovement] = useState<'CASH_IN' | 'CASH_OUT' | null>(null);
  const [closing, setClosing] = useState(false);
  const { data: current, isPending } = useQuery({
    queryKey: cashSessionKey,
    queryFn: () => api.get<{ session: CashSessionDto | null }>('/cash-sessions/current'),
  });
  const open = !!current?.session;
  const { data: summary } = useQuery({
    queryKey: summaryKey,
    queryFn: () =>
      api
        .get<{ summary: CashSessionSummary | null }>('/cash-sessions/current/summary')
        .then((r) => r.summary),
    enabled: open,
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Cash register"
        description="Open the day, record cash in and out, and count the drawer when you close."
        actions={
          open ? (
            <>
              <Button variant="outline" onClick={() => setMovement('CASH_IN')}>
                <ArrowDownToLine /> Cash in
              </Button>
              <Button variant="outline" onClick={() => setMovement('CASH_OUT')}>
                <ArrowUpFromLine /> Cash out
              </Button>
              <Button onClick={() => setClosing(true)} disabled={!summary}>
                <Moon /> Close the day
              </Button>
            </>
          ) : (
            !isPending && (
              <Button onClick={() => setOpening(true)}>
                <Sunrise /> Open the day
              </Button>
            )
          )
        }
      />

      {!isPending && !open && (
        <Card className="mb-6">
          <EmptyState
            icon={Wallet}
            title="The day is not open"
            description="Count the cash in the drawer and open the day to start selling."
          />
        </Card>
      )}

      {summary && (
        <div className="mb-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                label="Sales today"
                value={money(summary.totalSales)}
                sub={`${summary.billCount} bill(s)`}
              />
              <Stat
                label="Cash that should be in the drawer"
                value={money(summary.expectedCash)}
                strong
              />
              <Stat
                label="Opened"
                value={new Date(summary.openedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                sub={summary.openedBy.fullName}
              />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Drawer</CardTitle>
              </CardHeader>
              <CardContent>
                <SummaryLines s={summary} />
              </CardContent>
            </Card>
          </div>
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>Cash in and out today</CardTitle>
            </CardHeader>
            {!summary.movements.length ? (
              <p className="text-muted-foreground p-5 text-sm">Nothing yet.</p>
            ) : (
              <ul className="divide-y">
                {summary.movements.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.reason}</span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {m.userName}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'tabular-nums',
                        m.type === 'CASH_IN' ? 'text-success' : 'text-destructive',
                      )}
                    >
                      {m.type === 'CASH_IN' ? '+' : '−'}
                      {money(m.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {can('reports.view') && <PastDays />}

      <OpenDayDialog open={opening} onClose={() => setOpening(false)} />
      <Dialog open={!!movement} onOpenChange={(o) => !o && setMovement(null)}>
        <DialogContent className="sm:max-w-sm">
          {movement && <MovementForm type={movement} onDone={() => setMovement(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="sm:max-w-2xl">
          {closing && summary && (
            <CloseDayForm summary={summary} onDone={() => setClosing(false)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <Card className={cn('gap-1 py-4', strong && 'border-brand/40 bg-accent/40')}>
      <CardHeader className="px-4">
        <CardTitle className="text-muted-foreground text-sm font-normal">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SummaryLines({ s }: { s: CashSessionSummary }) {
  const money = useMoney();
  const row = (label: string, value: number, sign: '+' | '−' | '' = '', muted = false) => (
    <div className={cn('flex justify-between py-1.5 text-sm', muted && 'text-muted-foreground')}>
      <span>{label}</span>
      <span className="tabular-nums">
        {sign && value !== 0 ? `${sign} ` : ''}
        {money(value)}
      </span>
    </div>
  );
  return (
    <div className="grid gap-x-10 md:grid-cols-2">
      <div className="divide-y">
        {row('Opening cash', s.openingCash)}
        {row('Cash sales', s.cashSales, '+')}
        {row('Customer payments (cash)', s.customerCashPayments, '+')}
        {row('Cash in', s.cashIn, '+')}
        {row('Cash out', s.cashOut, '−')}
        {row('Cash refunds', s.cashRefunds, '−')}
        {row('Expenses paid from the drawer', s.drawerExpenses, '−')}
        <div className="flex justify-between py-2 font-semibold">
          <span>Expected in drawer</span>
          <span className="tabular-nums">{money(s.expectedCash)}</span>
        </div>
      </div>
      <div className="divide-y">
        {row('Card sales', s.cardSales, '', true)}
        {row('Bank transfer sales', s.bankSales, '', true)}
        {row('Credit (on account) sales', s.creditSales, '', true)}
        {row('Other refunds', s.otherRefunds, '', true)}
        <div className="text-muted-foreground flex justify-between py-1.5 text-sm">
          <span>Bills / voided / returns</span>
          <span className="tabular-nums">
            {s.billCount} / {s.voidCount} / {s.returnCount}
          </span>
        </div>
      </div>
    </div>
  );
}

function MovementForm({ type, onDone }: { type: 'CASH_IN' | 'CASH_OUT'; onDone: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post<CashSessionSummary>('/cash-sessions/current/movements', { type, amount, reason }),
    onSuccess: (summary) => {
      qc.setQueryData(summaryKey, summary);
      toast.success(type === 'CASH_IN' ? 'Cash in recorded' : 'Cash out recorded');
      onDone();
    },
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount > 0 && reason.trim().length >= 3) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {type === 'CASH_IN' ? 'Put cash in the drawer' : 'Take cash out of the drawer'}
        </DialogTitle>
        <DialogDescription>
          {type === 'CASH_IN'
            ? 'e.g. extra change from the bank.'
            : 'e.g. money taken to the bank. Shop expenses go on the Expenses page.'}
        </DialogDescription>
      </DialogHeader>
      <FormField label="Amount">
        <MoneyInput autoFocus value={amount} onChange={setAmount} />
      </FormField>
      <FormField label="Reason">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <DialogFooter>
        <Button
          type="submit"
          disabled={!(amount > 0) || reason.trim().length < 3 || save.isPending}
        >
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function CloseDayForm({ summary, onDone }: { summary: CashSessionSummary; onDone: () => void }) {
  const qc = useQueryClient();
  const money = useMoney();
  const printDay = usePrintDay();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const fromNotes = LKR_DENOMINATIONS.reduce((s, d) => s + d * 100 * (Number(counts[d]) || 0), 0);
  const usedNotes = Object.values(counts).some((v) => Number(v) > 0);
  const counted = typed ?? fromNotes;
  const diff = counted - summary.expectedCash;

  const close = useMutation({
    mutationFn: () =>
      api.post<CashSessionSummary>('/cash-sessions/current/close', {
        countedCash: counted,
        denominations: usedNotes
          ? Object.fromEntries(
              Object.entries(counts)
                .filter(([, v]) => Number(v) > 0)
                .map(([k, v]) => [k, Number(v)]),
            )
          : undefined,
        note: note || undefined,
      }),
    onSuccess: (closed) => {
      qc.setQueryData(cashSessionKey, { session: null });
      qc.removeQueries({ queryKey: summaryKey });
      qc.invalidateQueries({ queryKey: ['cash-sessions'] });
      toast.success('The day is closed. Printing the day report.');
      void printDay(closed.id);
      onDone();
    },
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        close.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Close the day</DialogTitle>
        <DialogDescription>
          Count the notes and coins in the drawer. The day report prints when you finish.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
        {LKR_DENOMINATIONS.map((d) => (
          <label key={d} className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Rs {d.toLocaleString()}</span>
            <Input
              inputMode="numeric"
              value={counts[d] ?? ''}
              onChange={(e) => {
                setTyped(null);
                setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, '') }));
              }}
              placeholder="0"
              className="tabular-nums"
            />
          </label>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Cash counted">
          <MoneyInput value={counted} onChange={setTyped} />
        </FormField>
        <div className="rounded-lg border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Should be</span>
            <span className="tabular-nums">{money(summary.expectedCash)}</span>
          </div>
          <div
            className={cn(
              'mt-1 flex justify-between font-semibold',
              diff < 0 ? 'text-destructive' : diff > 0 ? 'text-success' : '',
            )}
          >
            <span>{diff === 0 ? 'Exact' : diff < 0 ? 'Short' : 'Over'}</span>
            <span className="tabular-nums">{money(Math.abs(diff))}</span>
          </div>
        </div>
      </div>
      <FormField label={diff !== 0 ? 'Note (why is it different?)' : 'Note (optional)'}>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <DialogFooter>
        <Button type="submit" size="lg" disabled={close.isPending}>
          {close.isPending ? <Loader2 className="animate-spin" /> : <Moon />} Close the day and
          print
        </Button>
      </DialogFooter>
    </form>
  );
}

function PastDays() {
  const money = useMoney();
  const printDay = usePrintDay();
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['cash-sessions', page],
    queryFn: () => api.get<Page<CashSessionSummary>>(`/cash-sessions${qs({ page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const closed = data?.items.filter((d) => d.status === 'CLOSED') ?? [];
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>Past days</CardTitle>
      </CardHeader>
      {!closed.length ? (
        <p className="text-muted-foreground p-5 text-sm">No closed days yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Closed by</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Expected cash</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {closed.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  {new Date(d.openedAt).toLocaleDateString()}
                  <span className="text-muted-foreground block text-xs">
                    {new Date(d.openedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    –{' '}
                    {d.closedAt &&
                      new Date(d.closedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                  </span>
                </TableCell>
                <TableCell>{d.closedBy?.fullName ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{money(d.totalSales)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(d.expectedCash)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.countedCash === null ? '—' : money(d.countedCash)}
                </TableCell>
                <TableCell className="text-right">
                  {d.difference === null ? (
                    '—'
                  ) : d.difference === 0 ? (
                    <Badge variant="success">Exact</Badge>
                  ) : (
                    <Badge variant={d.difference < 0 ? 'destructive' : 'warning'}>
                      {d.difference < 0 ? 'Short' : 'Over'} {money(Math.abs(d.difference))}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => void printDay(d.id)}>
                    <Printer /> Report
                  </Button>
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
  );
}
