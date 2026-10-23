import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bot,
  CircleAlert,
  Cpu,
  FileDown,
  History,
  Lightbulb,
  Palette,
  Percent,
  Printer,
  ReceiptText,
  ScanBarcode,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import { checkSettings, type AllSettings, type SettingsIssue } from '@shoppos/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FullScreenLoader } from '@/app/guards';
import { useCan } from '@/lib/auth';
import { useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useAssistantStatus } from '../assistant/assistant-chat';
import { AiForm } from './ai-form';
import { BrandingForm } from './branding-form';
import { PrinterForm } from './printer-form';
import { ReceiptCard } from './receipt-card';
import {
  AppearanceCard,
  ApprovalsForm,
  PosForm,
  ShopForm,
  TaxForm,
  TaxRatesCard,
} from './section-forms';
import { SettingsAssistant } from './settings-assistant';
import { SettingsHistory } from './settings-history';
import { SettingsTransfer } from './settings-transfer';

type PageId =
  | 'overview'
  | 'shop'
  | 'receipt'
  | 'printer'
  | 'billing'
  | 'tax'
  | 'approvals'
  | 'look'
  | 'assistant'
  | 'history'
  | 'copy';

const PAGES: { id: PageId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'overview', label: 'Overview', icon: Sparkles, hint: 'Setup check and assistant' },
  { id: 'shop', label: 'Shop details', icon: Store, hint: 'Name, address, phone' },
  { id: 'receipt', label: 'Receipt', icon: ReceiptText, hint: 'Receipt Studio' },
  { id: 'printer', label: 'Printer', icon: Printer, hint: 'Receipt printer, drawer' },
  { id: 'billing', label: 'Billing', icon: ScanBarcode, hint: 'Rounding, stock, lock' },
  { id: 'tax', label: 'VAT and tax', icon: Percent, hint: 'VAT number, tax rates' },
  { id: 'approvals', label: 'Admin approval', icon: ShieldCheck, hint: 'What needs a PIN' },
  { id: 'look', label: 'Look', icon: Palette, hint: 'Theme, logo, colours' },
  { id: 'assistant', label: 'Assistant', icon: Cpu, hint: 'Free local AI' },
  { id: 'history', label: 'History', icon: History, hint: 'Compare and undo' },
  { id: 'copy', label: 'Copy settings', icon: FileDown, hint: 'Save to / open a file' },
];

/** Words people may search for, and the page that has them. */
const SEARCH: { page: PageId; label: string; words: string }[] = [
  { page: 'shop', label: 'Shop name', words: 'shop name title business' },
  {
    page: 'shop',
    label: 'Address, phone and email',
    words: 'address phone telephone email contact',
  },
  {
    page: 'receipt',
    label: 'Receipt design',
    words:
      'receipt bill design layout template logo footer header qr whatsapp barcode thank you studio',
  },
  {
    page: 'receipt',
    label: 'Copies of every receipt',
    words: 'copies copy shop copy credit signature',
  },
  {
    page: 'printer',
    label: 'Receipt printer',
    words: 'printer usb network thermal chrome print test',
  },
  {
    page: 'printer',
    label: 'Paper width (58 / 80 mm)',
    words: 'paper width 58 80 mm characters line',
  },
  { page: 'printer', label: 'Cash drawer and paper cut', words: 'drawer cash open kick cut feed' },
  { page: 'billing', label: 'Rounding', words: 'round rounding nearest cents decimals' },
  { page: 'billing', label: 'Currency', words: 'currency symbol rs lkr money' },
  { page: 'billing', label: 'Selling with no stock', words: 'stock zero negative out of stock' },
  { page: 'billing', label: 'Print after payment', words: 'auto print automatic receipt payment' },
  { page: 'billing', label: 'Screen lock', words: 'lock idle screen minutes pin' },
  {
    page: 'billing',
    label: 'Wholesale / retail start',
    words: 'wholesale retail price mode default',
  },
  { page: 'tax', label: 'VAT', words: 'vat tax registered number inclusive' },
  { page: 'tax', label: 'Tax rates', words: 'tax rate percent default' },
  { page: 'approvals', label: 'Cashier discount limit', words: 'discount cashier limit percent' },
  {
    page: 'approvals',
    label: 'Admin PIN for actions',
    words: 'admin approval pin void refund price drawer credit',
  },
  { page: 'look', label: 'Dark mode', words: 'dark light theme appearance' },
  { page: 'look', label: 'Logo and colours', words: 'logo colour color brand branding app name' },
  {
    page: 'assistant',
    label: 'Free local AI',
    words: 'ai assistant ollama model qwen local offline',
  },
  {
    page: 'history',
    label: 'History and compare',
    words: 'history compare undo restore version changes audit who',
  },
  {
    page: 'copy',
    label: 'Save / open settings file',
    words: 'export import file backup copy transfer second shop',
  },
  { page: 'overview', label: 'Setup check', words: 'check health problems overview' },
];

const ISSUE_PAGE: Record<SettingsIssue['section'], PageId> = {
  shop: 'shop',
  receipt: 'receipt',
  receiptLibrary: 'receipt',
  tax: 'tax',
  pos: 'billing',
  approvals: 'approvals',
  printer: 'printer',
  backup: 'copy',
  branding: 'look',
  ai: 'assistant',
};

export function SettingsPage() {
  const { data: settings } = useSettings();
  const canBrand = useCan()('branding.manage');
  const [params, setParams] = useSearchParams();
  const page = (PAGES.find((p) => p.id === params.get('s'))?.id ?? 'overview') as PageId;
  const go = (id: PageId) => setParams(id === 'overview' ? {} : { s: id }, { replace: false });
  if (!settings) return <FullScreenLoader />;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Set these once; the shop then runs by itself."
        actions={<SettingsSearch onGo={go} />}
      />
      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          className="bg-card grid gap-0.5 rounded-xl border p-1.5 lg:sticky lg:top-4"
          aria-label="Settings sections"
        >
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => go(p.id)}
              aria-current={page === p.id ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                page === p.id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'hover:bg-muted/70',
              )}
            >
              <p.icon
                className={cn(
                  'size-4 shrink-0',
                  page === p.id ? 'text-brand' : 'text-muted-foreground',
                )}
              />
              <span className="min-w-0">
                <span className="block truncate">{p.label}</span>
                <span className="text-muted-foreground block truncate text-[11px] font-normal">
                  {p.hint}
                </span>
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {page === 'overview' && <Overview settings={settings} onGo={go} />}
          {page === 'shop' && (
            <div className="max-w-3xl">
              <ShopForm settings={settings} />
            </div>
          )}
          {page === 'receipt' && <ReceiptCard settings={settings} />}
          {page === 'printer' && <PrinterForm settings={settings} />}
          {page === 'billing' && (
            <div className="max-w-3xl">
              <PosForm settings={settings} />
            </div>
          )}
          {page === 'tax' && (
            <div className="grid max-w-3xl gap-5">
              <TaxForm settings={settings} />
              <TaxRatesCard />
            </div>
          )}
          {page === 'approvals' && (
            <div className="max-w-3xl">
              <ApprovalsForm settings={settings} />
            </div>
          )}
          {page === 'look' && (
            <div className="grid gap-5">
              <div className="max-w-3xl">
                <AppearanceCard />
              </div>
              {canBrand && <BrandingForm settings={settings} />}
            </div>
          )}
          {page === 'assistant' && (
            <div className="max-w-3xl">
              <AiForm settings={settings} />
            </div>
          )}
          {page === 'history' && <SettingsHistory settings={settings} />}
          {page === 'copy' && (
            <div className="max-w-3xl">
              <SettingsTransfer settings={settings} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** "Rounding" → Billing. Type to find any setting. */
function SettingsSearch({ onGo }: { onGo: (page: PageId) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return SEARCH.filter((s) =>
      words.every((w) => `${s.label} ${s.words}`.toLowerCase().includes(w)),
    ).slice(0, 8);
  }, [q]);
  const pick = (page: PageId) => {
    onGo(page);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };
  return (
    <div className="relative w-72">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && results[active]) {
            pick(results[active]!.page);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="Search settings, e.g. rounding"
        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/40 h-10 w-full rounded-md border pr-3 pl-9 text-sm outline-none focus-visible:ring-[3px]"
      />
      {open && q.trim() && (
        <ul className="bg-popover absolute inset-x-0 top-11 z-30 overflow-hidden rounded-lg border shadow-lg">
          {results.length === 0 ? (
            <li className="text-muted-foreground px-3 py-2 text-sm">
              Nothing found. Try the assistant on Overview.
            </li>
          ) : (
            results.map((r, i) => {
              const page = PAGES.find((p) => p.id === r.page)!;
              return (
                <li key={`${r.page}-${r.label}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(r.page)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                      i === active ? 'bg-accent' : 'hover:bg-muted',
                    )}
                  >
                    <page.icon className="text-muted-foreground size-4" />
                    <span className="flex-1">{r.label}</span>
                    <span className="text-muted-foreground text-xs">{page.label}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

const LEVEL: Record<SettingsIssue['level'], { icon: LucideIcon; className: string }> = {
  error: { icon: CircleAlert, className: 'text-destructive' },
  warning: { icon: TriangleAlert, className: 'text-amber-600' },
  tip: { icon: Lightbulb, className: 'text-sky-600' },
};

/** The start page of Settings: what to fix, and the assistant to change things in plain words. */
function Overview({ settings, onGo }: { settings: AllSettings; onGo: (page: PageId) => void }) {
  const issues = checkSettings(settings);
  const { data: ai } = useAssistantStatus();
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Setup check</CardTitle>
            <CardDescription>
              {issues.length
                ? 'A few things worth a look. Each one opens the right page.'
                : 'Everything important is set up.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {issues.length === 0 ? (
              <p className="text-success flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-5" /> No problems found.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {issues.map((i) => {
                  const L = LEVEL[i.level];
                  return (
                    <li key={i.id} className="flex items-start gap-3 px-3 py-2.5">
                      <L.icon className={cn('mt-0.5 size-4 shrink-0', L.className)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{i.title}</p>
                        <p className="text-muted-foreground text-xs">{i.detail}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onGo(ISSUE_PAGE[i.section])}
                      >
                        Fix
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <ReceiptCard settings={settings} />
        <QuickLinks onGo={onGo} />
      </div>
      <Card className="xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="text-brand size-5" /> Assistant
          </CardTitle>
          <CardDescription>
            Change settings in plain words. You see every change before it is saved.
            {!ai?.enabled && (
              <>
                {' '}
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => onGo('assistant')}
                >
                  Turn on the free local AI
                </button>{' '}
                for any request.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-[480px] flex-col">
          <SettingsAssistant />
        </CardContent>
      </Card>
    </div>
  );
}

function QuickLinks({ onGo }: { onGo: (page: PageId) => void }) {
  const links: [PageId, string, ReactNode][] = [
    ['printer', 'Test the printer', 'Print a test page and open the drawer'],
    ['history', 'See what changed', 'Who changed which setting, compare and undo'],
    ['copy', 'Copy settings', 'Save them to a file or take them from another shop'],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {links.map(([id, title, text]) => {
        const page = PAGES.find((p) => p.id === id)!;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onGo(id)}
            className="bg-card hover:border-brand/50 grid gap-1 rounded-xl border p-4 text-left transition-colors"
          >
            <page.icon className="text-brand size-5" />
            <span className="font-medium">{title}</span>
            <span className="text-muted-foreground text-xs">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
