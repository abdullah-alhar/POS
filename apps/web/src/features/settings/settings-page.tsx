import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { FullScreenLoader } from '@/app/guards';
import { useCan } from '@/lib/auth';
import { useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
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
import { SettingsHistory } from './settings-history';
import { Overview } from './settings-overview';
import { GROUPS, PAGES, SEARCH, type PageId } from './settings-pages';
import { SettingsTransfer } from './settings-transfer';

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
