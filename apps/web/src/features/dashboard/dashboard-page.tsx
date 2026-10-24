import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  DatabaseBackup,
  PackageX,
  ReceiptText,
  ScanBarcode,
  TrendingUp,
  Moon,
  Undo2,
  PackagePlus,
  Truck,
  ChartColumn,
  Users,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router';
import {
  PAYMENT_METHOD_LABELS,
  type BackupStatusDto,
  type Dashboard,
  type DashboardDay,
  type PaymentMethod,
} from '@shoppos/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { formatDay } from '@/lib/dates';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const money = useMoney();
  const can = useCan();
  const { data: me } = useMe();
  const { data, isPending } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/reports/dashboard'),
    refetchInterval: 60_000,
  });
  const { data: backup } = useQuery({
    queryKey: ['backups', 'status', 'dashboard'],
    queryFn: async () => {
      const status = await api.get<BackupStatusDto>('/backups/status');
      const ageHours = status.lastOk
        ? (Date.now() - new Date(status.lastOk.createdAt).getTime()) / 3_600_000
        : null;
      return { ...status, ageHours };
    },
    enabled: can('backups.manage'),
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const lastBackupAge = backup?.ageHours ?? null;

  return (
    <>
      <PageHeader
        title={`${greeting}${me ? `, ${me.fullName.split(' ')[0]}` : ''}`}
        description={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />

      {data && (
        <div className="mb-5 grid gap-2">
          {data.outOfStock > 0 && (
            <Alert
              tone="bad"
              to="/products?low=1"
              text={`${data.outOfStock} item(s) are out of stock.`}
            />
          )}
          {data.lowStock > 0 && (
            <Alert
              tone="warn"
              to="/products?low=1"
              text={`${data.lowStock} item(s) are running low.`}
            />
          )}
          {backup && (!backup.lastOk || (lastBackupAge ?? 0) > 36) && (
            <Alert
              tone="bad"
              to="/backups"
              text={
                backup.lastOk
                  ? `The last backup is ${Math.floor((lastBackupAge ?? 0) / 24)} day(s) old.`
                  : 'No backup has been made yet.'
              }
            />
          )}
        </div>
      )}

      <QuickActions dayOpen={data?.dayOpen} />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={TrendingUp}
          label="Sales today"
          value={data && money(data.today.sales)}
          compare={data ? { now: data.today.sales, before: data.yesterday.sales } : undefined}
        />
        <Stat
          icon={Wallet}
          label="Profit today"
          value={data && money(data.today.profit)}
          sub={data && `after ${money(data.today.expenses)} expenses`}
        />
        <Stat
          icon={ReceiptText}
          label="Bills today"
          value={data && String(data.today.bills)}
          sub={data && (data.today.bills ? `average ${money(data.today.avgBill)}` : 'no bills yet')}
        />
        <Stat
          icon={Users}
          label="Customers owe"
          value={data && money(data.owedByCustomers)}
          sub={data && `you owe suppliers ${money(data.owedToSuppliers)}`}
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Last 30 days</CardTitle>
            <span className="text-muted-foreground flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="bg-brand inline-block size-2.5 rounded-sm" /> Sales
              </span>
              <span className="flex items-center gap-1">
                <span className="bg-success inline-block h-0.5 w-3" /> Profit
              </span>
            </span>
          </CardHeader>
          <CardContent>
            {isPending ? <Skeleton className="h-64" /> : data && <SalesChart days={data.days} />}
          </CardContent>
        </Card>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Top items today</CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.topToday.length ? (
                <p className="text-muted-foreground text-sm">Nothing sold yet today.</p>
              ) : (
                <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">
                  {data.topToday.map((t, i) => (
                    <li key={t.name} className="flex items-center gap-3 text-sm">
                      <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      <span className="text-muted-foreground tabular-nums">×{t.qty}</span>
                      <span className="w-24 text-right font-medium tabular-nums">
                        {money(t.sales)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Payments today</CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.paymentsToday.length ? (
                <p className="text-muted-foreground text-sm">No payments yet.</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {data.paymentsToday.map((p) => (
                    <li key={p.method} className="flex justify-between">
                      <span>
                        {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}{' '}
                        <span className="text-muted-foreground">({p.count})</span>
                      </span>
                      <span className="font-medium tabular-nums">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {can('backups.manage') && backup && (
            <Card className="gap-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DatabaseBackup className="size-4" /> Backup
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {backup.lastOk
                  ? `Last backup ${new Date(backup.lastOk.createdAt).toLocaleString()}`
                  : 'No backup yet.'}
                <Button asChild variant="link" className="h-auto px-1">
                  <Link to="/backups">Open backups</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Alert({ tone, text, to }: { tone: 'bad' | 'warn' | 'info'; text: string; to: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium hover:opacity-90',
        tone === 'bad' && 'border-destructive/30 bg-destructive/10 text-destructive',
        tone === 'warn' && 'border-warning/40 bg-warning/15 text-amber-800 dark:text-warning',
        tone === 'info' && 'bg-accent text-accent-foreground',
      )}
    >
      {tone === 'info' ? (
        <Wallet className="size-4" />
      ) : tone === 'bad' ? (
        <PackageX className="size-4" />
      ) : (
        <AlertTriangle className="size-4" />
      )}
      {text}
    </Link>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  compare,
}: {
  icon: typeof TrendingUp;
  label: string;
  value?: string;
  sub?: string;
  compare?: { now: number; before: number };
}) {
  const change =
    compare && compare.before > 0
      ? Math.round(((compare.now - compare.before) / compare.before) * 100)
      : null;
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="text-muted-foreground text-sm font-normal">{label}</CardTitle>
        <Icon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent className="px-4">
        {value === undefined ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        )}
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          {change !== null && (
            <span
              className={cn(
                'flex items-center font-medium',
                change >= 0 ? 'text-success' : 'text-destructive',
              )}
            >
              {change >= 0 ? (
                <ArrowUpRight className="size-3.5" />
              ) : (
                <ArrowDownRight className="size-3.5" />
              )}
              {Math.abs(change)}% vs yesterday
            </span>
          )}
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}

/** Bars for sales, a line for profit. Plain SVG keeps the app small and fast on the shop laptop. */
export function SalesChart({ days }: { days: DashboardDay[] }) {
  const money = useMoney();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...days.map((d) => d.sales), ...days.map((d) => d.profit));
  const min = Math.min(0, ...days.map((d) => d.profit));
  const span = max - min;
  const y = (v: number) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const step = (W - pad.l - pad.r) / Math.max(1, days.length);
  const bar = Math.max(2, step * 0.62);
  const x = (i: number) => pad.l + i * step + step / 2;
  const line = days
    .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.profit).toFixed(1)}`)
    .join(' ');
  const h = hover === null ? null : days[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-64 w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Sales and profit for the last 30 days"
      >
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={y(0)}
          y2={y(0)}
          className="stroke-border"
          strokeWidth={1}
        />
        {days.map((d, i) => (
          <g key={d.date} onMouseEnter={() => setHover(i)}>
            <rect
              x={x(i) - step / 2}
              y={pad.t}
              width={step}
              height={H - pad.t - pad.b}
              fill="transparent"
            />
            <rect
              x={x(i) - bar / 2}
              y={y(Math.max(0, d.sales))}
              width={bar}
              height={Math.max(d.sales > 0 ? 1.5 : 0, y(0) - y(Math.max(0, d.sales)))}
              rx={2}
              className={cn(
                'fill-brand transition-opacity',
                hover !== null && hover !== i && 'opacity-40',
              )}
            />
            {(i % 5 === 0 || i === days.length - 1) && (
              <text
                x={x(i)}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {formatDay(d.date, { day: 'numeric', month: 'short' })}
              </text>
            )}
          </g>
        ))}
        <path
          d={line}
          fill="none"
          className="stroke-success"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {h && (
        <div className="bg-popover text-popover-foreground pointer-events-none absolute top-0 right-0 rounded-lg border px-3 py-2 text-xs shadow-md">
          <p className="font-semibold">
            {formatDay(h.date, { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
          <p>Sales {money(h.sales)}</p>
          <p>Profit {money(h.profit)}</p>
          <p>{h.bills} bill(s)</p>
        </div>
      )}
    </div>
  );
}

/** Big buttons for the jobs done every day, so nobody has to search the menu. */
function QuickActions({ dayOpen }: { dayOpen?: boolean }) {
  const can = useCan();
  const actions: {
    to: string;
    label: string;
    hint: string;
    icon: typeof ScanBarcode;
    show: boolean;
    primary?: boolean;
  }[] = [
    {
      to: '/billing',
      label: 'New sale',
      hint: 'Scan items and take payment',
      icon: ScanBarcode,
      show: true,
      primary: true,
    },
    {
      to: '/cash',
      label: dayOpen === false ? 'Cash register' : 'Close the day',
      hint:
        dayOpen === false
          ? 'The day starts with the first sale'
          : 'Count the cash and print the report',
      icon: dayOpen === false ? Wallet : Moon,
      show: can('cash.register'),
    },
    {
      to: '/returns/new',
      label: 'Return',
      hint: 'Customer brings an item back',
      icon: Undo2,
      show: can('returns.create'),
    },
    {
      to: '/products/new',
      label: 'Add product',
      hint: 'A new item to sell',
      icon: PackagePlus,
      show: can('products.manage'),
    },
    {
      to: '/purchases/new',
      label: 'Stock arrived',
      hint: 'Add a delivery from a supplier',
      icon: Truck,
      show: can('purchases.manage'),
    },
    {
      to: '/reports',
      label: 'Reports',
      hint: 'Sales and profit',
      icon: ChartColumn,
      show: can('reports.view'),
    },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {actions
        .filter((a) => a.show)
        .map((a) => (
          <Link
            key={a.to + a.label}
            to={a.to}
            className={cn(
              'group flex flex-col gap-2 rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md',
              a.primary ? 'bg-brand text-white' : 'bg-card hover:border-brand/40',
            )}
          >
            <a.icon className={cn('size-7', a.primary ? 'text-white' : 'text-brand')} />
            <span className="text-base font-semibold">{a.label}</span>
            <span className={cn('text-xs', a.primary ? 'text-white/80' : 'text-muted-foreground')}>
              {a.hint}
            </span>
          </Link>
        ))}
    </div>
  );
}
