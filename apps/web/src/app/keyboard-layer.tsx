import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CornerDownLeft,
  Keyboard,
  Lock,
  LogOut,
  Moon,
  ScanSearch,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { warrantyLabel, type PosIndexItem } from '@shoppos/shared';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useMoney, usePublicSettings } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { searchItems } from '@/features/billing/search';
import { usePosIndex } from '@/features/billing/use-pos-index';
import { AskPanel } from '@/features/assistant/ask-panel';
import { NAV } from './nav';

type Panel = 'palette' | 'help' | 'price' | 'ask';

/** Open a panel from anywhere (menu items, footer buttons). */
export function openPanel(panel: Panel | 'lock') {
  window.dispatchEvent(new CustomEvent('pos:panel', { detail: panel }));
}

/** Open Ask with a question already typed (from Ctrl+K). */
export function askQuestion(question: string) {
  window.dispatchEvent(new CustomEvent('pos:ask', { detail: question }));
}

/** Lock = log out but remember who was working, so the PIN screen opens for them. The bill stays. */
export function useLock() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: me } = useMe();
  return async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    navigate('/login', {
      replace: true,
      state: { from: location.pathname, lockedUserId: me?.id, locked: true },
    });
  };
}

/**
 * Keys that work on every page:
 *   Ctrl+K  go to any page or action      F12     all keyboard shortcuts
 *   Ctrl+I  price check                   Ctrl+L  lock the screen
 *   Ctrl+J  Ask (the assistant)
 * Also locks the screen after the idle time set in Settings → Billing.
 */
export function KeyboardLayer() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [question, setQuestion] = useState<string | undefined>();
  const lock = useLock();
  const lockRef = useRef(lock);
  useEffect(() => {
    lockRef.current = lock;
  });
  const { data: settings } = usePublicSettings();
  const idleMinutes = settings?.pos.autoLockMinutes ?? 0;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === 'k') {
        e.preventDefault();
        setPanel((p) => (p === 'palette' ? null : 'palette'));
      } else if (e.key === 'F12') {
        e.preventDefault();
        setPanel((p) => (p === 'help' ? null : 'help'));
      } else if (ctrl && k === 'i') {
        e.preventDefault();
        setPanel('price');
      } else if (ctrl && k === 'l') {
        e.preventDefault();
        void lockRef.current();
      } else if (ctrl && k === 'j') {
        e.preventDefault();
        setQuestion(undefined);
        setPanel((p) => (p === 'ask' ? null : 'ask'));
      }
    }
    function onPanel(e: Event) {
      const p = (e as CustomEvent<Panel | 'lock'>).detail;
      if (p === 'lock') void lockRef.current();
      else setPanel(p);
    }
    function onAsk(e: Event) {
      setQuestion((e as CustomEvent<string>).detail);
      setPanel('ask');
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('pos:panel', onPanel);
    window.addEventListener('pos:ask', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pos:panel', onPanel);
      window.removeEventListener('pos:ask', onAsk);
    };
  }, []);

  // Idle lock: any key, click or mouse move resets the timer.
  useEffect(() => {
    if (!idleMinutes) return;
    let timer = setTimeout(() => void lockRef.current(), idleMinutes * 60_000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void lockRef.current(), idleMinutes * 60_000);
    };
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [idleMinutes]);

  const close = () => setPanel(null);
  return (
    <>
      <CommandPalette open={panel === 'palette'} onClose={close} onPanel={setPanel} />
      <ShortcutsDialog open={panel === 'help'} onClose={close} />
      <PriceCheckDialog open={panel === 'price'} onClose={close} />
      <AskPanel open={panel === 'ask'} onClose={close} question={question} />
    </>
  );
}

interface Command {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  keys?: string;
  run: () => void;
}

function CommandPalette({
  open,
  onClose,
  onPanel,
}: {
  open: boolean;
  onClose: () => void;
  onPanel: (p: Panel) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <DialogDescription className="sr-only">Type to find a page or an action</DialogDescription>
        {open && <PaletteBody onClose={onClose} onPanel={onPanel} />}
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({ onClose, onPanel }: { onClose: () => void; onPanel: (p: Panel) => void }) {
  const navigate = useNavigate();
  const can = useCan();
  const lock = useLock();
  const { toggle } = useTheme();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const pages: Command[] = NAV.flatMap((item) =>
      item.pages
        .filter((p) => !p.permission || can(p.permission))
        .map((p) => ({
          id: p.to,
          label: p.label === item.label ? p.label : `${item.label}: ${p.label}`,
          group: 'Go to',
          icon: item.icon,
          run: () => navigate(p.to),
        })),
    );
    const actions: Command[] = [
      {
        id: 'price',
        label: 'Price check',
        group: 'Actions',
        icon: ScanSearch,
        keys: 'Ctrl+I',
        run: () => onPanel('price'),
      },
      {
        id: 'help',
        label: 'Keyboard shortcuts',
        group: 'Actions',
        icon: Keyboard,
        keys: 'F12',
        run: () => onPanel('help'),
      },
      {
        id: 'ask',
        label: 'Ask the assistant',
        group: 'Actions',
        icon: Sparkles,
        keys: 'Ctrl+J',
        run: () => onPanel('ask'),
      },
      {
        id: 'lock',
        label: 'Lock the screen',
        group: 'Actions',
        icon: Lock,
        keys: 'Ctrl+L',
        run: () => void lock(),
      },
      { id: 'theme', label: 'Dark / light mode', group: 'Actions', icon: Moon, run: toggle },
      ...(can('returns.create')
        ? [
            {
              id: 'ret',
              label: 'New return',
              group: 'Actions',
              icon: CornerDownLeft,
              run: () => navigate('/returns/new'),
            },
          ]
        : []),
      { id: 'logout', label: 'Log out', group: 'Actions', icon: LogOut, run: () => void lock() },
    ];
    return [...pages, ...actions];
  }, [can, navigate, onPanel, lock, toggle]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = commands.filter((c) =>
    words.every((w) => `${c.label} ${c.group}`.toLowerCase().includes(w)),
  );
  // Anything typed can also be asked: "best sellers this week", "how do I close the day?"
  const shown: Command[] =
    q.trim().length > 2
      ? [
          ...matches,
          {
            id: 'ask-question',
            label: `Ask: “${q.trim()}”`,
            group: 'Ask the assistant',
            icon: Sparkles,
            run: () => askQuestion(q.trim()),
          },
        ]
      : matches;

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function run(c: Command | undefined) {
    if (!c) return;
    // Panels replace the palette; pages close it.
    if (c.id !== 'price' && c.id !== 'help' && c.id !== 'ask') onClose();
    c.run();
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4">
        <Search className="text-muted-foreground size-4" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (shown.length)
                setActive(
                  (a) => (a + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length,
                );
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(shown[active]);
            }
          }}
          placeholder="Go to a page, do something or ask a question…"
          className="h-14 flex-1 bg-transparent text-base outline-none"
        />
        <kbd className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">Esc</kbd>
      </div>
      <ul ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
        {shown.length === 0 && (
          <li className="text-muted-foreground p-4 text-sm">Nothing found.</li>
        )}
        {shown.map((c, i) => (
          <li key={c.id}>
            {(i === 0 || shown[i - 1]!.group !== c.group) && (
              <p className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">
                {c.group}
              </p>
            )}
            <button
              type="button"
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
                i === active && 'bg-accent text-accent-foreground',
              )}
            >
              <c.icon className="size-4 opacity-70" />
              <span className="flex-1">{c.label}</span>
              {c.keys && (
                <kbd className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
                  {c.keys}
                </kbd>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="text-muted-foreground flex gap-4 border-t px-4 py-2 text-[11px]">
        <span>↑ ↓ choose</span>
        <span>Enter open</span>
        <span>Esc close</span>
      </div>
    </>
  );
}

const SHORTCUTS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Everywhere',
    keys: [
      ['Ctrl + K', 'Go to any page or action'],
      ['Ctrl + I', 'Price check (scan or type an item)'],
      ['Ctrl + L', 'Lock the screen (your PIN opens it again)'],
      ['Ctrl + J', 'Ask: sales, stock, customers, how to …'],
      ['F12', 'This list'],
      ['Enter', 'Confirm a warning / save a form'],
      ['Esc', 'Cancel / close'],
      ['Tab', 'Next field'],
    ],
  },
  {
    title: 'Billing',
    keys: [
      ['Scan / type + Enter', 'Add an item (↑ ↓ to pick from the list)'],
      ['3 * then scan', 'Add 3 of the item'],
      ['5 * then Enter', 'Set the selected item to 5'],
      ['*', 'Type the quantity of the selected item'],
      ['+ / −', 'One more / one less'],
      ['↑ ↓  Home  End', 'Choose an item on the bill'],
      ['Delete / Backspace', 'Remove the selected item (Enter confirms)'],
      ['Ctrl + D', 'Change quantity, price or discount'],
      ['F1', 'New bill'],
      ['F2', 'Back to the scan box'],
      ['F3', 'Customer'],
      ['F4', 'Pay'],
      ['F6 / F7', 'Hold the bill / bring a held bill back'],
      ['F8', 'Discount on the whole bill'],
      ['F9', 'Retail / wholesale prices'],
      ['F10', 'Print the last receipt again'],
      ['Ctrl + Q', 'Print the bill as a quotation'],
    ],
  },
  {
    title: 'Payment window',
    keys: [
      ['Enter', 'Pay the amount in the box (it starts with what is due)'],
      ['Type an amount', 'Cash given; the change is shown'],
      ['F4', 'Exact cash'],
      ['C / K / B / A', 'Cash / card / bank transfer / on account'],
      ['Esc', 'Back to the bill'],
    ],
  },
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-5" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Everything in ShopPOS can be done from the keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] gap-6 overflow-y-auto md:columns-2">
          {SHORTCUTS.map((group) => (
            <section key={group.title} className="mb-6 break-inside-avoid">
              <h3 className="mb-2 text-sm font-semibold">{group.title}</h3>
              <dl className="divide-y rounded-lg border">
                {group.keys.map(([k, what]) => (
                  <div key={k} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <dt className="w-36 shrink-0">
                      <kbd className="bg-muted rounded px-1.5 py-0.5 text-xs font-medium">{k}</kbd>
                    </dt>
                    <dd className="text-muted-foreground">{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PriceCheckDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="size-5" /> Price check
          </DialogTitle>
          <DialogDescription>Scan or type an item. Nothing is added to the bill.</DialogDescription>
        </DialogHeader>
        {open && <PriceCheckBody />}
      </DialogContent>
    </Dialog>
  );
}

function PriceCheckBody() {
  const money = useMoney();
  const { catalog } = usePosIndex();
  const [text, setText] = useState('');
  const [item, setItem] = useState<PosIndexItem | null>(null);
  const [notFound, setNotFound] = useState('');
  const [active, setActive] = useState(0);
  const suggestions =
    catalog && text.trim().length >= 2 && !/^\d{6,}$/.test(text.trim())
      ? searchItems(catalog.items, text.trim())
      : [];

  function pick(found: PosIndexItem | undefined, code: string) {
    setItem(found ?? null);
    setNotFound(found ? '' : code);
    setText('');
    setActive(0);
  }

  return (
    <div className="grid gap-4">
      <div className="relative">
        <input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (suggestions.length)
                setActive(
                  (a) =>
                    (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length,
                );
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const code = text.trim();
              if (!code || !catalog) return;
              pick(
                catalog.find(code) ?? (/^[\d\s-]+$/.test(code) ? undefined : suggestions[active]),
                code,
              );
            }
          }}
          placeholder={catalog ? 'Scan a barcode or type a name' : 'Loading items…'}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/40 h-12 w-full rounded-lg border px-4 text-lg outline-none focus-visible:ring-[3px]"
        />
        {suggestions.length > 0 && (
          <ul className="bg-popover absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border shadow-lg">
            {suggestions.map((s, i) => (
              <li key={s.variantId}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(s, s.sku)}
                  className={cn(
                    'flex w-full justify-between gap-3 px-4 py-2 text-left text-sm',
                    i === active && 'bg-accent',
                  )}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="tabular-nums">{money(s.retailPrice)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {notFound && <p className="text-destructive text-sm">No item with the code “{notFound}”.</p>}
      {item && (
        <div className="bg-muted/40 grid gap-3 rounded-xl border p-4">
          <div>
            <p className="text-lg font-semibold">{item.name}</p>
            <p className="text-muted-foreground font-mono text-xs">
              {item.sku}
              {item.barcodes[0] && ` · ${item.barcodes[0]}`}
              {item.brand && ` · ${item.brand}`}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-muted-foreground text-xs">Retail</p>
              <p className="text-2xl font-bold tabular-nums">{money(item.retailPrice)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Wholesale</p>
              <p className="text-2xl font-bold tabular-nums">{money(item.wholesalePrice)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">In stock</p>
              {item.trackStock ? (
                <Badge
                  variant={
                    item.stockQty <= 0 ? 'destructive' : item.stockQty <= 3 ? 'warning' : 'success'
                  }
                  className="mt-1 text-base"
                >
                  {item.stockQty}
                </Badge>
              ) : (
                <p className="text-sm">Not counted</p>
              )}
            </div>
          </div>
          {(item.warrantyDays > 0 || item.trackSerial) && (
            <p className="text-sm">
              {item.warrantyDays > 0 && `Warranty: ${warrantyLabel(item.warrantyDays)}`}
              {item.warrantyDays > 0 && item.trackSerial && ' · '}
              {item.trackSerial && 'Serial / IMEI recorded when sold'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
