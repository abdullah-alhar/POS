import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  PAYMENT_METHOD_LABELS,
  type CashierReportRow,
  type PaymentMethod,
  type PaymentReportRow,
  type ProductReportRow,
  type ReportGroup,
  type SalesReport,
  type SalesReportRow,
  type StockValueReport,
  type StockValueRow,
} from '@marina/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { formatDay, RANGE_PRESETS, type DateRange } from '@/lib/dates';
import { useMoney, usePublicSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { SalesChart } from '../dashboard/dashboard-page';
import { exportExcel, exportPdf, type ExportColumn, type ExportTable } from './export';

const rangeLabel = (r: DateRange) =>
  r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} – ${formatDay(r.to)}`;

export function ReportsPage() {
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState<DateRange>(
    RANGE_PRESETS.find((p) => p.id === 'month')!.range(),
  );
  const [tab, setTab] = useState('sales');

  return (
    <>
      <PageHeader
        title="Reports"
        description="Sales, profit, stock and staff. Export any report to Excel or PDF."
      />
      <Card className="mb-5 flex flex-row flex-wrap items-end gap-3 p-3">
        <div className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={preset === p.id ? 'default' : 'ghost'}
              onClick={() => {
                setPreset(p.id);
                setRange(p.range());
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-end gap-2">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">From</span>
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) =>
                e.target.value && (setPreset(''), setRange((r) => ({ ...r, from: e.target.value })))
              }
              className="w-40"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">To</span>
            <Input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) =>
                e.target.value && (setPreset(''), setRange((r) => ({ ...r, to: e.target.value })))
              }
              className="w-40"
            />
          </label>
        </div>
      </Card>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3 flex-wrap">
          <TabsTrigger value="sales">Sales & profit</TabsTrigger>
          <TabsTrigger value="best">Best sellers</TabsTrigger>
          <TabsTrigger value="slow">Slow movers</TabsTrigger>
          <TabsTrigger value="stock">Stock value</TabsTrigger>
          <TabsTrigger value="cashiers">Cashiers</TabsTrigger>
          <TabsTrigger value="payments">Payment methods</TabsTrigger>
        </TabsList>
        <TabsContent value="sales">{tab === 'sales' && <SalesTab range={range} />}</TabsContent>
        <TabsContent value="best">
          {tab === 'best' && <ProductsTab range={range} sort="best" />}
        </TabsContent>
        <TabsContent value="slow">
          {tab === 'slow' && <ProductsTab range={range} sort="slow" />}
        </TabsContent>
        <TabsContent value="stock">{tab === 'stock' && <StockTab />}</TabsContent>
        <TabsContent value="cashiers">
          {tab === 'cashiers' && <CashiersTab range={range} />}
        </TabsContent>
        <TabsContent value="payments">
          {tab === 'payments' && <PaymentsTab range={range} />}
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Excel and PDF buttons for a report table. */
function ExportButtons<T>({ table }: { table: ExportTable<T> | null }) {
  const { data: settings } = usePublicSettings();
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  async function run(kind: 'xlsx' | 'pdf') {
    if (!table) return;
    setBusy(kind);
    try {
      const shop = settings?.shop.name ?? 'Marina POS';
      if (kind === 'xlsx') await exportExcel(table, shop);
      else await exportPdf(table, shop, settings?.pos.currencySymbol ?? 'Rs');
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!table || !!busy}
        onClick={() => void run('xlsx')}
      >
        {busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!table || !!busy}
        onClick={() => void run('pdf')}
      >
        {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText />} PDF
      </Button>
    </div>
  );
}

/** One table driven by the same column list that the export uses. */
function ReportTable<T>({
  columns,
  rows,
  totals,
  rowKey,
  loading,
  empty,
}: {
  columns: ExportColumn<T>[];
  rows: T[];
  totals?: T;
  rowKey: (r: T) => string;
  loading: boolean;
  empty: string;
}) {
  const money = useMoney();
  const show = (c: ExportColumn<T>, r: T) => {
    const v = c.value(r);
    if (v === null || v === undefined) return '—';
    if (c.kind === 'money') return money(Number(v));
    if (c.kind === 'int') return Number(v).toLocaleString();
    return String(v);
  };
  if (loading) return <Skeleton className="m-4 h-40" />;
  if (!rows.length) return <p className="text-muted-foreground p-6 text-sm">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.header} className={cn(c.kind && c.kind !== 'text' && 'text-right')}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={rowKey(r)}>
            {columns.map((c) => {
              const v = c.value(r);
              return (
                <TableCell
                  key={c.header}
                  className={cn(
                    c.kind && c.kind !== 'text' && 'text-right tabular-nums',
                    c.kind === 'money' && typeof v === 'number' && v < 0 && 'text-destructive',
                  )}
                >
                  {show(c, r)}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
      {totals && (
        <TableFooter>
          <TableRow>
            {columns.map((c) => (
              <TableCell
                key={c.header}
                className={cn(
                  'font-semibold',
                  c.kind && c.kind !== 'text' && 'text-right tabular-nums',
                )}
              >
                {show(c, totals)}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}

function ReportCard({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

const periodLabel = (group: ReportGroup) => (r: SalesReportRow) =>
  r.period === 'Total'
    ? 'Total'
    : group === 'month'
      ? formatDay(r.period, { month: 'long', year: 'numeric' })
      : group === 'week'
        ? `Week of ${formatDay(r.period, { day: 'numeric', month: 'short' })}`
        : formatDay(r.period, { weekday: 'short', day: 'numeric', month: 'short' });

function SalesTab({ range }: { range: DateRange }) {
  const [group, setGroup] = useState<ReportGroup>('day');
  const { data, isPending } = useQuery({
    queryKey: ['reports', 'sales', range, group],
    queryFn: () => api.get<SalesReport>(`/reports/sales${qs({ ...range, groupBy: group })}`),
    placeholderData: keepPreviousData,
  });
  const columns: ExportColumn<SalesReportRow>[] = [
    {
      header: group === 'day' ? 'Day' : group === 'week' ? 'Week' : 'Month',
      value: periodLabel(group),
    },
    { header: 'Bills', value: (r) => r.bills, kind: 'int' },
    { header: 'Sales', value: (r) => r.sales, kind: 'money' },
    { header: 'Discounts', value: (r) => r.discounts, kind: 'money' },
    { header: 'Returns', value: (r) => r.returns, kind: 'money' },
    { header: 'Net sales', value: (r) => r.netSales, kind: 'money' },
    { header: 'Tax', value: (r) => r.tax, kind: 'money' },
    { header: 'Cost of goods', value: (r) => r.cost, kind: 'money' },
    { header: 'Gross profit', value: (r) => r.grossProfit, kind: 'money' },
    { header: 'Expenses', value: (r) => r.expenses, kind: 'money' },
    { header: 'Net profit', value: (r) => r.netProfit, kind: 'money' },
  ];
  const rows = data?.rows ?? [];
  const totals = data ? { period: 'Total', ...data.totals } : undefined;
  const money = useMoney();
  return (
    <div className="grid gap-5">
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Mini
            label="Net sales"
            value={money(data.totals.netSales)}
            sub={`${data.totals.bills} bills`}
          />
          <Mini
            label="Gross profit"
            value={money(data.totals.grossProfit)}
            sub={
              data.totals.netSales
                ? `${Math.round((data.totals.grossProfit / Math.max(1, data.totals.netSales - data.totals.tax)) * 100)}% margin`
                : undefined
            }
          />
          <Mini label="Expenses" value={money(data.totals.expenses)} />
          <Mini
            label="Net profit"
            value={money(data.totals.netProfit)}
            bad={data.totals.netProfit < 0}
          />
        </div>
      )}
      {group === 'day' && rows.length > 1 && rows.length <= 92 && (
        <Card className="p-4">
          <SalesChart
            days={rows.map((r) => ({
              date: r.period,
              sales: r.netSales,
              profit: r.netProfit,
              bills: r.bills,
            }))}
          />
        </Card>
      )}
      <ReportCard
        title="Sales and profit"
        actions={
          <>
            <Select value={group} onValueChange={(v) => setGroup(v as ReportGroup)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">By day</SelectItem>
                <SelectItem value="week">By week</SelectItem>
                <SelectItem value="month">By month</SelectItem>
              </SelectContent>
            </Select>
            <ExportButtons
              table={
                data
                  ? {
                      title: 'Sales and profit',
                      subtitle: rangeLabel(range),
                      fileName: `sales-${range.from}-to-${range.to}`,
                      columns,
                      rows,
                      totals,
                    }
                  : null
              }
            />
          </>
        }
      >
        <ReportTable
          columns={columns}
          rows={rows}
          totals={totals}
          rowKey={(r) => r.period}
          loading={isPending}
          empty="No sales in these dates."
        />
      </ReportCard>
      <p className="text-muted-foreground text-xs">
        Net sales = sales − returns. Gross profit = net sales − tax − cost of the goods (items put
        back on the shelf after a return give their cost back). Net profit = gross profit −
        expenses.
      </p>
    </div>
  );
}

function Mini({
  label,
  value,
  sub,
  bad,
}: {
  label: string;
  value: string;
  sub?: string;
  bad?: boolean;
}) {
  return (
    <Card className="gap-1 px-4 py-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums', bad && 'text-destructive')}>{value}</p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </Card>
  );
}

function ProductsTab({ range, sort }: { range: DateRange; sort: 'best' | 'slow' }) {
  const { data = [], isPending } = useQuery({
    queryKey: ['reports', 'products', range, sort],
    queryFn: () =>
      api.get<ProductReportRow[]>(`/reports/products${qs({ ...range, sort, limit: 200 })}`),
    placeholderData: keepPreviousData,
  });
  const columns: ExportColumn<ProductReportRow>[] = [
    { header: 'Item', value: (r) => r.name },
    { header: 'SKU', value: (r) => r.sku },
    { header: 'Category', value: (r) => r.category ?? '' },
    { header: 'Sold', value: (r) => r.qtySold, kind: 'int' },
    { header: 'Sales', value: (r) => r.sales, kind: 'money' },
    { header: 'Profit', value: (r) => r.profit, kind: 'money' },
    { header: 'In stock', value: (r) => r.stockQty, kind: 'int' },
    {
      header: 'Last sold',
      value: (r) => (r.lastSoldAt ? new Date(r.lastSoldAt).toLocaleDateString() : 'Never'),
    },
  ];
  const title = sort === 'best' ? 'Best sellers' : 'Slow movers';
  return (
    <ReportCard
      title={
        sort === 'best' ? 'Best sellers (most sold first)' : 'Slow movers: in stock but sold least'
      }
      actions={
        <ExportButtons
          table={{
            title,
            subtitle: rangeLabel(range),
            fileName: `${sort === 'best' ? 'best-sellers' : 'slow-movers'}-${range.from}-to-${range.to}`,
            columns,
            rows: data,
          }}
        />
      }
    >
      <ReportTable
        columns={columns}
        rows={data}
        rowKey={(r) => r.variantId}
        loading={isPending}
        empty="Nothing to show for these dates."
      />
    </ReportCard>
  );
}

function StockTab() {
  const { data, isPending } = useQuery({
    queryKey: ['reports', 'stock-value'],
    queryFn: () => api.get<StockValueReport>('/reports/stock-value'),
  });
  const columns: ExportColumn<StockValueRow>[] = [
    { header: 'Category', value: (r) => r.category },
    { header: 'Items', value: (r) => r.items, kind: 'int' },
    { header: 'Quantity', value: (r) => r.qty, kind: 'int' },
    { header: 'Value at cost', value: (r) => r.costValue, kind: 'money' },
    { header: 'Value at retail price', value: (r) => r.retailValue, kind: 'money' },
    { header: 'Possible profit', value: (r) => r.retailValue - r.costValue, kind: 'money' },
  ];
  const totals = data ? { category: 'Total', ...data.totals } : undefined;
  return (
    <ReportCard
      title="Stock value now"
      actions={
        <ExportButtons
          table={
            data
              ? {
                  title: 'Stock value',
                  subtitle: `On ${formatDay(new Date().toISOString())}`,
                  fileName: `stock-value-${new Date().toISOString().slice(0, 10)}`,
                  columns,
                  rows: data.rows,
                  totals,
                }
              : null
          }
        />
      }
    >
      <ReportTable
        columns={columns}
        rows={data?.rows ?? []}
        totals={totals}
        rowKey={(r) => r.category}
        loading={isPending}
        empty="No stock."
      />
    </ReportCard>
  );
}

function CashiersTab({ range }: { range: DateRange }) {
  const { data = [], isPending } = useQuery({
    queryKey: ['reports', 'cashiers', range],
    queryFn: () => api.get<CashierReportRow[]>(`/reports/cashiers${qs({ ...range })}`),
    placeholderData: keepPreviousData,
  });
  const columns: ExportColumn<CashierReportRow>[] = [
    { header: 'User', value: (r) => r.name },
    { header: 'Bills', value: (r) => r.bills, kind: 'int' },
    { header: 'Sales', value: (r) => r.sales, kind: 'money' },
    { header: 'Discounts given', value: (r) => r.discounts, kind: 'money' },
    { header: 'Voided bills', value: (r) => r.voids, kind: 'int' },
    { header: 'Refunds', value: (r) => r.returns, kind: 'money' },
  ];
  return (
    <ReportCard
      title="Sales by cashier"
      actions={
        <ExportButtons
          table={{
            title: 'Sales by cashier',
            subtitle: rangeLabel(range),
            fileName: `cashiers-${range.from}-to-${range.to}`,
            columns,
            rows: data,
          }}
        />
      }
    >
      <ReportTable
        columns={columns}
        rows={data}
        rowKey={(r) => r.userId}
        loading={isPending}
        empty="No sales in these dates."
      />
    </ReportCard>
  );
}

function PaymentsTab({ range }: { range: DateRange }) {
  const { data = [], isPending } = useQuery({
    queryKey: ['reports', 'payments', range],
    queryFn: () => api.get<PaymentReportRow[]>(`/reports/payments${qs({ ...range })}`),
    placeholderData: keepPreviousData,
  });
  const columns: ExportColumn<PaymentReportRow>[] = [
    {
      header: 'Method',
      value: (r) => PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ?? r.method,
    },
    { header: 'Payments', value: (r) => r.count, kind: 'int' },
    { header: 'Amount', value: (r) => r.amount, kind: 'money' },
  ];
  const totals = data.length
    ? {
        method: 'Total',
        count: data.reduce((s, r) => s + r.count, 0),
        amount: data.reduce((s, r) => s + r.amount, 0),
      }
    : undefined;
  return (
    <ReportCard
      title="Payment methods"
      actions={
        <ExportButtons
          table={{
            title: 'Payment methods',
            subtitle: rangeLabel(range),
            fileName: `payments-${range.from}-to-${range.to}`,
            columns,
            rows: data,
            totals,
          }}
        />
      }
    >
      <ReportTable
        columns={columns}
        rows={data}
        totals={totals}
        rowKey={(r) => r.method}
        loading={isPending}
        empty="No payments in these dates."
      />
    </ReportCard>
  );
}
