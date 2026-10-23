import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Download,
  FileUp,
  GitCompareArrows,
  History,
  Keyboard,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  Printer,
  Redo2,
  Replace,
  Save,
  ScrollText,
  Undo2,
} from 'lucide-react';
import { useBlocker, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  diffLayouts,
  summarizeChanges,
  type AllSettings,
  type ReceiptCheckContext,
  type ReceiptSettings,
} from '@shoppos/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { keys } from '@/lib/queries';
import { safeStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { printHtml } from '../receipts/print';
import { receiptHtml } from '../receipts/receipt-html';
import { duplicatePieces, nudgePieces, removePieces, selectAll, toggleHidden } from './actions';
import { AssistantPanel } from './assistant-panel';
import { Canvas } from './canvas';
import { ChangeList } from './change-list';
import { ChecksPanel, useChecks } from './checks-panel';
import { downloadDesign, readDesignFile } from './design-file';
import { FindReplaceDialog } from './find-replace-dialog';
import { HistoryPanel } from './history-panel';
import { AddTools, LayersPanel } from './layers-panel';
import { LibraryDialog } from './library-dialog';
import { PropertiesPanel } from './properties-panel';
import { currentDesign, useDesign, useStudio, type Design, type DockTab } from './store';
import {
  SCENARIOS,
  toReceiptSettings,
  useReceiptPreview,
  type PreviewView,
  type Scenario,
} from './use-preview';

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
const ZOOM_KEY = 'receipt-studio-zoom';

const SHORTCUTS: [string, string][] = [
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+S', 'Save'],
  ['Click, Ctrl+click, Shift+click', 'Select one, add, select a range'],
  ['↑ ↓ (Shift)', 'Select the piece above / below (more)'],
  ['Alt+↑ / Alt+↓', 'Move the selection up / down'],
  ['Enter or double-click', 'Type in a text piece'],
  ['Delete', 'Remove the selection'],
  ['Ctrl+D', 'Duplicate'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste pieces'],
  ['Ctrl+A', 'Select everything'],
  ['Ctrl+E', 'Hide / show (hidden pieces are not printed)'],
  ['Ctrl+H', 'Find and replace words'],
  ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom in / out / 100%'],
  ['/', 'Ask the assistant'],
  ['Esc', 'Clear the selection'],
];

function sameDesign(a: Design, b: Design) {
  return (
    a.copies === b.copies &&
    a.shopCopyForCredit === b.shopCopyForCredit &&
    JSON.stringify(a.layout) === JSON.stringify(b.layout)
  );
}

/**
 * The receipt editor ("Receipt Studio"): a full-screen workspace like a design app.
 * Left: pieces to add and the layers. Middle: the receipt on paper, filled in with a real bill.
 * Right: the options of what is selected, and the assistant, the design check and the history.
 */
export function ReceiptStudio({ settings }: { settings: AllSettings }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const branding = useBranding();
  const initial = useMemo<Design>(
    () => ({
      layout: settings.receipt.layout,
      copies: settings.receipt.copies,
      shopCopyForCredit: settings.receipt.shopCopyForCredit,
    }),
    // Only when the editor opens; saving updates `saved` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [saved, setSaved] = useState<Design>(initial);
  // Start a fresh history before the first paint, so the last session's design never shows.
  useState(() => useStudio.getState().reset(initial));

  const design = useDesign() ?? initial;
  const steps = useStudio((s) => s.steps);
  const index = useStudio((s) => s.index);
  const dock = useStudio((s) => s.dock);
  const compare = useStudio((s) => s.compare);
  const dirty = !sameDesign(design, saved);

  const [zoom, setZoomState] = useState(() => Number(safeStorage.get(ZOOM_KEY)) || 1);
  const setZoom = (z: number) => {
    const next = Math.min(2, Math.max(0.5, Math.round(z * 100) / 100));
    setZoomState(next);
    safeStorage.set(ZOOM_KEY, String(next));
  };
  const [printerView, setPrinterView] = useState(false);
  const [view, setView] = useState<PreviewView>({
    scenario: 'latest',
    billNumber: '',
    charsPerLine: settings.printer.charsPerLine,
  });
  const [billInput, setBillInput] = useState('');
  const preview = useReceiptPreview(design, view);

  const checkCtx = useMemo<ReceiptCheckContext>(
    () => ({
      charsPerLine: view.charsPerLine,
      vatRegistered: settings.tax.vatRegistered,
      printerMode: settings.printer.mode,
      hasPrinterLogo: !!settings.printer.logo,
      estimateMm: preview.data?.estimate.mm,
    }),
    [view.charsPerLine, settings.tax.vatRegistered, settings.printer, preview.data?.estimate.mm],
  );
  const issues = useChecks(design, checkCtx);
  const serious = issues.filter((i) => i.level !== 'tip').length;

  const [dialog, setDialog] = useState<'library' | 'find' | 'keys' | 'saveCheck' | null>(null);
  const assistantRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<Design | null>(null);

  // ── Save and print ──
  const save = useMutation({
    mutationFn: () =>
      api.put<ReceiptSettings>(
        '/settings/receipt',
        toReceiptSettings(currentDesign(), settings.receipt.language),
      ),
    onSuccess: (value) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) =>
        old ? { ...old, receipt: value } : old,
      );
      qc.invalidateQueries({ queryKey: keys.publicSettings });
      qc.invalidateQueries({ queryKey: ['settings-history'] });
      setSaved(currentDesign());
      toast.success('Receipt saved. New bills print like this.');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save'),
  });
  const trySave = () => {
    if (!dirty || save.isPending) return;
    if (issues.some((i) => i.level === 'error')) setDialog('saveCheck');
    else save.mutate();
  };
  const printIt = useMutation({
    mutationFn: async () => {
      if (settings.printer.mode === 'browser') {
        if (preview.data) await printHtml(receiptHtml(preview.data.doc, branding.logo));
      } else {
        await api.post('/printing/receipt-preview', {
          receipt: toReceiptSettings(currentDesign()),
          scenario: view.scenario,
          billNumber: view.billNumber || undefined,
          print: true,
        });
      }
    },
    onSuccess: () => toast.success('Test receipt printed'),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not print'),
  });

  // ── Leaving with unsaved changes ──
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ── Keyboard, like a design app ──
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      const st = useStudio.getState();
      const sel = st.selected;
      const layout = currentDesign().layout;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (ctrl && k === 'z') run(() => (e.shiftKey ? st.redo() : st.undo()));
      else if (ctrl && k === 'y') run(st.redo);
      else if (ctrl && k === 's') run(trySave);
      else if (ctrl && k === 'a') run(selectAll);
      else if (ctrl && k === 'h') run(() => setDialog('find'));
      else if (ctrl && (k === '=' || k === '+'))
        run(() => setZoom(ZOOMS.find((z) => z > zoom) ?? 2));
      else if (ctrl && k === '-')
        run(() => setZoom([...ZOOMS].reverse().find((z) => z < zoom) ?? 0.5));
      else if (ctrl && k === '0') run(() => setZoom(1));
      else if (ctrl && k === 'v') run(st.paste);
      else if (e.key === '/' && !ctrl)
        run(() => {
          st.setDock('assistant');
          setTimeout(() => assistantRef.current?.focus(), 0);
        });
      else if (e.key === '?') run(() => setDialog('keys'));
      else if (e.key === 'Escape') {
        if (st.compare) st.setCompare(false);
        else st.select(null);
      } else if (!sel.length) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && layout.length)
          run(() => st.select((e.key === 'ArrowDown' ? layout[0] : layout.at(-1))!.id));
      } else if (ctrl && k === 'c') run(st.copy);
      else if (ctrl && k === 'x')
        run(() => {
          st.copy();
          removePieces(sel);
        });
      else if (ctrl && k === 'd') run(() => duplicatePieces(sel));
      else if (ctrl && k === 'e') run(() => toggleHidden(sel));
      else if (e.key === 'Delete' || e.key === 'Backspace') run(() => removePieces(sel));
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = e.key === 'ArrowUp' ? -1 : 1;
        if (e.altKey) run(() => nudgePieces(sel, step));
        else
          run(() => {
            const idx = sel.map((id) => layout.findIndex((x) => x.id === id)).filter((i) => i >= 0);
            const from = step < 0 ? Math.min(...idx) : Math.max(...idx);
            const next = layout[Math.max(0, Math.min(layout.length - 1, from + step))];
            if (next) st.select(next.id, e.shiftKey ? 'toggle' : 'replace');
          });
      } else if (e.key === 'Enter') {
        const el = layout.find((x) => x.id === sel[0]);
        if (el?.type === 'text' && !el.locked) run(() => st.setEditing(el.id));
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changesVsSaved = useMemo(
    () => (dirty ? diffLayouts(saved.layout, design.layout) : []),
    [dirty, saved.layout, design.layout],
  );

  return (
    <div data-receipt-editor className="bg-background flex h-full flex-col">
      {/* ── Top bar ── */}
      <header className="bg-card flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
          <ArrowLeft /> Settings
        </Button>
        <div className="mr-2 flex items-center gap-2">
          <ScrollText className="text-brand size-5" />
          <h1 className="font-semibold">Receipt Studio</h1>
          {dirty ? (
            <Badge variant="warning" title={summarizeChanges(changesVsSaved)}>
              Not saved
            </Badge>
          ) : (
            <Badge variant="success">Saved</Badge>
          )}
        </div>

        <Group>
          <IconButton
            label="Undo (Ctrl+Z)"
            onClick={() => useStudio.getState().undo()}
            disabled={index === 0}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            label="Redo (Ctrl+Y)"
            onClick={() => useStudio.getState().redo()}
            disabled={index >= steps.length - 1}
          >
            <Redo2 />
          </IconButton>
        </Group>

        <Group>
          <IconButton
            label="Zoom out (Ctrl+-)"
            onClick={() => setZoom([...ZOOMS].reverse().find((z) => z < zoom) ?? 0.5)}
          >
            <Minus />
          </IconButton>
          <button
            type="button"
            title="Back to 100% (Ctrl+0)"
            onClick={() => setZoom(1)}
            className="hover:bg-muted h-8 w-12 rounded text-xs tabular-nums"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton
            label="Zoom in (Ctrl+=)"
            onClick={() => setZoom(ZOOMS.find((z) => z > zoom) ?? 2)}
          >
            <Plus />
          </IconButton>
        </Group>

        <Group>
          {(
            [
              [48, '80 mm'],
              [32, '58 mm'],
            ] as const
          ).map(([cpl, label]) => (
            <button
              key={cpl}
              type="button"
              title={`Show on ${label} paper${cpl === settings.printer.charsPerLine ? ' (your printer)' : ''}`}
              onClick={() => setView((v) => ({ ...v, charsPerLine: cpl }))}
              className={cn(
                'h-8 rounded px-2 text-xs font-medium',
                view.charsPerLine === cpl ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </Group>

        <Group>
          <ToggleButton
            on={printerView}
            onClick={() => setPrinterView((p) => !p)}
            label="Printer view: exactly what the receipt printer prints"
          >
            <Printer /> Printer view
          </ToggleButton>
          <ToggleButton
            on={compare}
            onClick={() => useStudio.getState().setCompare(!compare)}
            label="Show the saved receipt next to this one"
          >
            <GitCompareArrows /> Compare
          </ToggleButton>
        </Group>

        <Group>
          <span className="text-muted-foreground pl-1 text-xs">Show with</span>
          <Select
            value={view.billNumber ? 'bill' : view.scenario}
            onValueChange={(v) => {
              if (v === 'bill') return;
              setBillInput('');
              setView((cur) => ({ ...cur, scenario: v as Scenario, billNumber: '' }));
            }}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SCENARIOS) as Scenario[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SCENARIOS[s]}
                </SelectItem>
              ))}
              {view.billNumber && <SelectItem value="bill">Bill {view.billNumber}</SelectItem>}
            </SelectContent>
          </Select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setView((v) => ({ ...v, billNumber: billInput.trim().toUpperCase() }));
            }}
          >
            <Input
              value={billInput}
              onChange={(e) => setBillInput(e.target.value)}
              placeholder="Bill no."
              title="Type a bill number and press Enter to see the receipt with that bill"
              className="h-8 w-28 text-xs"
            />
          </form>
        </Group>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDialog('library')}>
            <LayoutTemplate /> Designs
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog('find')}>
                <Replace /> Find and replace…{' '}
                <span className="text-muted-foreground ml-auto text-xs">Ctrl+H</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => downloadDesign(currentDesign(), settings.shop.name)}
              >
                <Download /> Save design to a file
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                <FileUp /> Open a design file…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog('keys')}>
                <Keyboard /> Keyboard shortcuts{' '}
                <span className="text-muted-foreground ml-auto text-xs">?</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() => printIt.mutate()}
            disabled={!preview.data || printIt.isPending}
          >
            <Printer /> Test print
          </Button>
          <Button size="sm" onClick={trySave} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              setImported(await readDesignFile(file));
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        />
      </header>

      {/* ── Workspace ── */}
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_300px] xl:grid-cols-[250px_minmax(0,1fr)_350px]">
        <aside className="bg-card/50 flex min-h-0 flex-col gap-4 overflow-y-auto border-r p-3">
          <AddTools />
          <LayersPanel layout={design.layout} />
        </aside>

        <main className="min-h-0 overflow-auto">
          <Canvas
            design={design}
            saved={saved}
            preview={preview}
            view={view}
            zoom={zoom}
            printerView={printerView}
          />
        </main>

        <aside className="bg-card/50 flex min-h-0 flex-col border-l">
          <div className="max-h-[52%] shrink-0 overflow-y-auto border-b p-3">
            <PropertiesPanel design={design} estimateMm={preview.data?.estimate.mm} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex gap-1 border-b px-2 pt-2" role="tablist">
              <DockButton tab="assistant" current={dock} icon={<Bot />}>
                Assistant
              </DockButton>
              <DockButton tab="checks" current={dock} icon={<ListChecks />}>
                Check
                {serious > 0 && (
                  <span className="bg-destructive ml-1 rounded-full px-1.5 text-[10px] text-white">
                    {serious}
                  </span>
                )}
              </DockButton>
              <DockButton tab="history" current={dock} icon={<History />}>
                History
              </DockButton>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
              {dock === 'assistant' && <AssistantPanel inputRef={assistantRef} />}
              {dock === 'checks' && <ChecksPanel issues={issues} />}
              {dock === 'history' && <HistoryPanel />}
            </div>
          </div>
        </aside>
      </div>

      <LibraryDialog
        open={dialog === 'library'}
        onOpenChange={(o) => setDialog(o ? 'library' : null)}
        library={settings.receiptLibrary}
      />
      <FindReplaceDialog
        open={dialog === 'find'}
        onOpenChange={(o) => setDialog(o ? 'find' : null)}
      />
      <Dialog open={dialog === 'keys'} onOpenChange={(o) => setDialog(o ? 'keys' : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Everything also works with the mouse.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="bg-muted rounded px-1.5 py-0.5 text-xs">{k}</kbd>
                </dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
      <Dialog open={!!imported} onOpenChange={(o) => !o && setImported(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Use the design from this file?</DialogTitle>
            <DialogDescription>
              Compared with the receipt on the screen. You can press Undo afterwards.
            </DialogDescription>
          </DialogHeader>
          {imported && (
            <ChangeList
              changes={diffLayouts(design.layout, imported.layout)}
              fromLabel="now"
              toLabel="file"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setImported(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (imported)
                  useStudio.getState().commit('Opened a design file', imported, { select: [] });
                setImported(null);
              }}
            >
              Use this design
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={dialog === 'saveCheck'}
        onOpenChange={(o) => setDialog(o ? 'saveCheck' : null)}
        title="The design check found problems"
        description={`${issues
          .filter((i) => i.level === 'error')
          .map((i) => i.title)
          .join('. ')}. Save anyway?`}
        confirmText="Save anyway"
        onConfirm={() => {
          setDialog(null);
          save.mutate();
        }}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Leave without saving?"
        description={`The receipt has changes that are not saved (${summarizeChanges(changesVsSaved).toLowerCase()}).`}
        confirmText="Leave without saving"
        destructive
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="bg-muted/60 flex items-center gap-0.5 rounded-lg p-0.5">{children}</div>;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function ToggleButton({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium [&_svg]:size-3.5',
        on ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function DockButton({
  tab,
  current,
  icon,
  children,
}: {
  tab: DockTab;
  current: DockTab;
  icon: ReactNode;
  children: ReactNode;
}) {
  const active = tab === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => useStudio.getState().setDock(tab)}
      className={cn(
        '-mb-px flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium [&_svg]:size-3.5',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground border-transparent hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
