import { useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  CircleAlert,
  FileDown,
  History,
  LayoutGrid,
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
import {
  checkSettings,
  formatSetting,
  type AllSettings,
  type SettingsIssue,
} from '@shoppos/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FullScreenLoader } from '@/app/guards';
import { useCan } from '@/lib/auth';
import { useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { AiOrb } from '../assistant/ai-orb';
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

const PAGES: {
  id: PageId;
  label: string;
  icon: LucideIcon;
  hint: string;
  group: string;
  /** Icon tile colour on the overview. */
  tone: string;
}[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutGrid,
    hint: 'Setup check and assistant',
    group: '',
    tone: '',
  },
  {
    id: 'shop',
    label: 'Shop details',
    icon: Store,
    hint: 'Name, address, phone',
    group: 'Your shop',
    tone: 'bg-sky-500/12 text-sky-600',
  },
  {
    id: 'receipt',
    label: 'Receipt',
    icon: ReceiptText,
    hint: 'Design the printed bill',
    group: 'Your shop',
    tone: 'bg-violet-500/12 text-violet-600',
  },
  {
    id: 'printer',
    label: 'Printer',
    icon: Printer,
    hint: 'Receipt printer and drawer',
    group: 'Your shop',
    tone: 'bg-slate-500/12 text-slate-600',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: ScanBarcode,
    hint: 'Rounding, stock, screen lock',
    group: 'Selling',
    tone: 'bg-emerald-500/12 text-emerald-600',
  },
  {
    id: 'tax',
    label: 'VAT and tax',
    icon: Percent,
    hint: 'VAT number and tax rates',
    group: 'Selling',
    tone: 'bg-amber-500/12 text-amber-600',
  },
  {
    id: 'approvals',
    label: 'Admin approval',
    icon: ShieldCheck,
    hint: 'What needs an admin PIN',
    group: 'Selling',
    tone: 'bg-rose-500/12 text-rose-600',
  },
  {
    id: 'look',
    label: 'Look',
    icon: Palette,
    hint: 'Light or dark',
    group: 'App',
    tone: 'bg-pink-500/12 text-pink-600',
  },
  {
    id: 'assistant',
    label: 'AI assistant',
    icon: Sparkles,
    hint: 'Free AI: Groq, Gemini …',
    group: 'App',
    tone: 'bg-indigo-500/12 text-indigo-600',
  },
  {
    id: 'history',
    label: 'History',
    icon: History,
    hint: 'Compare and undo changes',
    group: 'Tools',
    tone: 'bg-teal-500/12 text-teal-600',
  },
  {
    id: 'copy',
    label: 'Copy settings',
    icon: FileDown,
    hint: 'Save to or open a file',
    group: 'Tools',
    tone: 'bg-orange-500/12 text-orange-600',
  },
];
const GROUPS = [...new Set(PAGES.map((p) => p.group))];

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
    label: 'Free AI (Groq, Gemini …)',
    words: 'ai assistant groq gemini openrouter mistral key free online ollama model local offline',
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

  const current = PAGES.find((p) => p.id === page)!;
  return (
    <>
      <PageHeader
        title="Settings"
        description="Set these once; the shop then runs by itself."
        actions={<SettingsSearch onGo={go} />}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
        <nav className="grid gap-4 lg:sticky lg:top-4" aria-label="Settings sections">
          {GROUPS.map((group) => (
            <div key={group || 'start'} className="grid gap-0.5">
              {group && (
                <p className="text-muted-foreground px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                  {group}
                </p>
              )}
              {PAGES.filter((p) => p.group === group).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(p.id)}
                  aria-current={page === p.id ? 'page' : undefined}
                  className={cn(
                    'relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-left text-sm transition-colors',
                    page === p.id
                      ? 'bg-card text-foreground font-medium shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                      : 'text-muted-foreground hover:bg-card/70 hover:text-foreground',
                  )}
                >
                  {page === p.id && (
                    <span className="bg-brand absolute inset-y-2 left-0 w-0.5 rounded-full" />
                  )}
                  <p.icon className={cn('size-4 shrink-0', page === p.id && 'text-brand')} />
                  <span className="truncate">{p.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {page !== 'overview' && (
            <div className="mb-5 flex items-center gap-3">
              <span
                className={cn('grid size-10 shrink-0 place-items-center rounded-xl', current.tone)}
              >
                <current.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg leading-tight font-semibold">{current.label}</h2>
                <p className="text-muted-foreground text-sm">{current.hint}</p>
              </div>
            </div>
          )}
          {page === 'overview' ? (
            <Overview settings={settings} onGo={go} />
          ) : (
            <div className="grid max-w-4xl gap-5">
              {page === 'shop' && <ShopForm settings={settings} />}
              {page === 'receipt' && <ReceiptCard settings={settings} />}
              {page === 'printer' && <PrinterForm settings={settings} />}
              {page === 'billing' && <PosForm settings={settings} />}
              {page === 'tax' && (
                <>
                  <TaxForm settings={settings} />
                  <TaxRatesCard />
                </>
              )}
              {page === 'approvals' && <ApprovalsForm settings={settings} />}
              {page === 'look' && (
                <>
                  <AppearanceCard />
                  {canBrand && <BrandingForm settings={settings} />}
                </>
              )}
              {page === 'assistant' && <AiForm settings={settings} />}
              {page === 'history' && <SettingsHistory settings={settings} />}
              {page === 'copy' && <SettingsTransfer settings={settings} />}
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

/** One line about how each section is set now, for the overview tiles. */
function summary(id: PageId, settings: AllSettings): string {
  switch (id) {
    case 'shop':
      return settings.shop.name || 'No shop name yet';
    case 'receipt':
      return `${settings.receipt.layout.length} pieces · ${formatSetting('receipt.copies', settings.receipt.copies)} cop${settings.receipt.copies === 1 ? 'y' : 'ies'}`;
    case 'printer':
      return formatSetting('printer.mode', settings.printer.mode);
    case 'billing':
      return `Totals: ${formatSetting('pos.roundingStep', settings.pos.roundingStep).toLowerCase()}`;
    case 'tax':
      return settings.tax.vatRegistered ? 'VAT registered' : 'No VAT';
    case 'approvals':
      return `Cashiers: up to ${formatSetting('approvals.cashierMaxDiscountBp', settings.approvals.cashierMaxDiscountBp)} discount`;
    case 'assistant':
      return formatSetting('ai.mode', settings.ai.mode);
    default:
      return PAGES.find((p) => p.id === id)!.hint;
  }
}

const LEVEL: Record<SettingsIssue['level'], { icon: LucideIcon; className: string }> = {
  error: { icon: CircleAlert, className: 'text-destructive' },
  warning: { icon: TriangleAlert, className: 'text-amber-600' },
  tip: { icon: Lightbulb, className: 'text-sky-600' },
};

/** The start page of Settings: every section at a glance, what to fix, and the assistant. */
function Overview({ settings, onGo }: { settings: AllSettings; onGo: (page: PageId) => void }) {
  const issues = checkSettings(settings);
  const { data: ai } = useAssistantStatus();
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid gap-6">
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {PAGES.filter((p) => p.id !== 'overview').map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onGo(p.id)}
              className="bg-card hover:border-brand/40 group flex items-center gap-3 rounded-xl border p-3.5 text-left shadow-xs transition-all hover:shadow-md"
            >
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', p.tone)}>
                <p.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {summary(p.id, settings)}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground/60 group-hover:text-brand size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Setup check
              {issues.length > 0 && (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                  {issues.length}
                </span>
              )}
            </CardTitle>
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
      </div>

      <Card className="gap-3 xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AiOrb size={22} glow={false} /> Change settings in words
          </CardTitle>
          <CardDescription>
            You see every change before it is saved.
            {(!ai || ai.mode === 'off' || !ai.ready) && (
              <>
                {' '}
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => onGo('assistant')}
                >
                  Turn on the free AI (Groq)
                </button>{' '}
                to use any words or language.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-[520px] flex-col">
          <SettingsAssistant />
        </CardContent>
      </Card>
    </div>
  );
}
