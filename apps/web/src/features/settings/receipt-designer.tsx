import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Barcode,
  Bold,
  Calculator,
  Copy,
  GripVertical,
  Hash,
  Image,
  ListOrdered,
  Loader2,
  Minus,
  MoveVertical,
  PiggyBank,
  Printer,
  QrCode,
  Redo2,
  Save,
  Trash2,
  Type,
  Undo2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  newElementId,
  RECEIPT_ELEMENT_INFO,
  RECEIPT_FIELDS,
  RECEIPT_TEMPLATES,
  type AllSettings,
  type ReceiptBlock,
  type ReceiptDoc,
  type ReceiptElement,
  type ReceiptElementType,
  type ReceiptField,
  type ReceiptSettings,
} from '@shoppos/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { keys } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { printHtml } from '../receipts/print';
import { blockHtml, receiptCss, receiptHtml } from '../receipts/receipt-html';

const ICONS: Record<ReceiptElementType, LucideIcon> = {
  text: Type,
  logo: Image,
  divider: Minus,
  space: MoveVertical,
  items: ListOrdered,
  totals: Calculator,
  payments: Wallet,
  itemCount: Hash,
  savings: PiggyBank,
  barcode: Barcode,
  qr: QrCode,
};
const ADD_ORDER: ReceiptElementType[] = [
  'text',
  'logo',
  'divider',
  'space',
  'items',
  'totals',
  'payments',
  'itemCount',
  'savings',
  'barcode',
  'qr',
];

function create(type: ReceiptElementType): ReceiptElement {
  const id = newElementId();
  switch (type) {
    case 'text':
      return { id, type, text: 'New text', align: 'center', bold: false, size: 'normal' };
    case 'divider':
      return { id, type, style: 'dashed' };
    case 'space':
      return { id, type, lines: 1 };
    case 'items':
      return {
        id,
        type,
        layout: 'two-line',
        showSku: false,
        showDiscounts: true,
        showWarranty: true,
        showSerial: true,
      };
    case 'qr':
      return { id, type, value: 'https://wa.me/94771234567' };
    default:
      return { id, type } as ReceiptElement;
  }
}

/** Undo / redo history of the design. */
function useHistory(initial: ReceiptElement[]) {
  const [state, setState] = useState({
    past: [] as ReceiptElement[][],
    present: initial,
    future: [] as ReceiptElement[][],
  });
  const set = useCallback(
    (next: ReceiptElement[] | ((cur: ReceiptElement[]) => ReceiptElement[])) => {
      setState((s) => {
        const value = typeof next === 'function' ? next(s.present) : next;
        if (value === s.present) return s;
        return { past: [...s.past.slice(-60), s.present], present: value, future: [] };
      });
    },
    [],
  );
  const undo = useCallback(
    () =>
      setState((s) =>
        s.past.length
          ? { past: s.past.slice(0, -1), present: s.past.at(-1)!, future: [s.present, ...s.future] }
          : s,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setState((s) =>
        s.future.length
          ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) }
          : s,
      ),
    [],
  );
  const reset = useCallback(
    (value: ReceiptElement[]) => setState({ past: [], present: value, future: [] }),
    [],
  );
  return {
    layout: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

/**
 * The receipt editor. The receipt is shown on paper, filled in with the latest bill; click a piece
 * to select it, drag it up or down, double-click text to type, add pieces from the left, and
 * remove them with the bin or the Delete key. Receipt printers print line by line, top to bottom,
 * which is why pieces move up and down rather than anywhere on the page.
 */
export function ReceiptDesigner({ settings }: { settings: AllSettings }) {
  const qc = useQueryClient();
  const branding = useBranding();
  const saved = settings.receipt;
  const history = useHistory(saved.layout);
  const { layout, set } = history;
  const [copies, setCopies] = useState(saved.copies);
  const [shopCopy, setShopCopy] = useState(saved.shopCopyForCredit);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [template, setTemplate] = useState<keyof typeof RECEIPT_TEMPLATES | null>(null);
  const [savedLayout, setSavedLayout] = useState(saved.layout);

  const receipt: ReceiptSettings = useMemo(
    () => ({ layout, copies, shopCopyForCredit: shopCopy, language: saved.language }),
    [layout, copies, shopCopy, saved.language],
  );
  const dirty =
    layout !== savedLayout || copies !== saved.copies || shopCopy !== saved.shopCopyForCredit;

  // The pieces filled in with the latest bill (or a sample), redrawn shortly after a change.
  const [draft, setDraft] = useState(receipt);
  useEffect(() => {
    const t = setTimeout(() => setDraft(receipt), 200);
    return () => clearTimeout(t);
  }, [receipt]);
  const { data: preview, isFetching } = useQuery({
    queryKey: ['receipt-preview', draft],
    queryFn: () =>
      api.post<{ doc: ReceiptDoc; pieces: { id: string; blocks: ReceiptBlock[] }[] }>(
        '/printing/receipt-preview',
        { receipt: draft },
      ),
    placeholderData: (prev) => prev,
  });
  const piecesById = useMemo(
    () => new Map(preview?.pieces.map((p) => [p.id, p.blocks]) ?? []),
    [preview],
  );

  const save = useMutation({
    mutationFn: () => api.put<ReceiptSettings>('/settings/receipt', receipt),
    onSuccess: (v) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) => (old ? { ...old, receipt: v } : old));
      qc.invalidateQueries({ queryKey: keys.publicSettings });
      setSavedLayout(layout);
      toast.success('Receipt saved. New bills print like this.');
    },
  });
  const printIt = useMutation({
    mutationFn: async () => {
      if (settings.printer.mode === 'browser') {
        if (preview) await printHtml(receiptHtml(preview.doc, branding.logo));
      } else await api.post('/printing/receipt-preview', { receipt, print: true });
    },
    onSuccess: () => toast.success('Test receipt printed'),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not print'),
  });

  // ── Editing actions ──
  const index = selected ? layout.findIndex((e) => e.id === selected) : -1;
  const update = (id: string, patch: Partial<ReceiptElement>) =>
    set((cur) => cur.map((e) => (e.id === id ? ({ ...e, ...patch } as ReceiptElement) : e)));
  const add = (type: ReceiptElementType, at?: number) => {
    const el = create(type);
    set((cur) => {
      const pos = at ?? (index >= 0 ? index + 1 : cur.length);
      return [...cur.slice(0, pos), el, ...cur.slice(pos)];
    });
    setSelected(el.id);
    if (type === 'text') setEditing(el.id);
  };
  const move = (id: string, to: number) =>
    set((cur) => {
      const from = cur.findIndex((e) => e.id === id);
      if (from < 0) return cur;
      const target = Math.max(0, Math.min(cur.length - 1, to > from ? to - 1 : to));
      if (target === from) return cur;
      const next = [...cur];
      const [el] = next.splice(from, 1);
      next.splice(target, 0, el!);
      return next;
    });
  const remove = (id: string) => {
    const i = layout.findIndex((e) => e.id === id);
    set((cur) => cur.filter((e) => e.id !== id));
    setSelected(layout[i + 1]?.id ?? layout[i - 1]?.id ?? null);
    setEditing(null);
  };
  const duplicate = (id: string) => {
    const i = layout.findIndex((e) => e.id === id);
    if (i < 0) return;
    const copy = { ...layout[i]!, id: newElementId() } as ReceiptElement;
    set((cur) => [...cur.slice(0, i + 1), copy, ...cur.slice(i + 1)]);
    setSelected(copy.id);
  };

  // Keyboard, like a design app: Delete, arrows, Alt+arrows to move, Ctrl+Z / Ctrl+Y, Ctrl+D.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]',
        )
      )
        return;
      // The editor is only on screen while the Receipt tab is open, so its keys can listen everywhere.
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (ctrl && k === 'y') {
        e.preventDefault();
        history.redo();
      } else if (ctrl && k === 's') {
        e.preventDefault();
        if (dirty) save.mutate();
      } else if (!selected) {
        if (e.key === 'ArrowDown' && layout[0]) {
          e.preventDefault();
          setSelected(layout[0].id);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(selected);
      } else if (ctrl && k === 'd') {
        e.preventDefault();
        duplicate(selected);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.key === 'ArrowUp' ? -1 : 1;
        if (e.altKey) move(selected, index + (step > 0 ? 2 : -1));
        else setSelected(layout[Math.max(0, Math.min(layout.length - 1, index + step))]!.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (layout[index]?.type === 'text') setEditing(selected);
      } else if (e.key === 'Escape') {
        setSelected(null);
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Drag and drop (pieces on the paper, and new pieces from the left) ──
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragRef = useRef<
    { kind: 'move'; id: string } | { kind: 'add'; type: ReceiptElementType } | null
  >(null);
  const onDropAt = (i: number) => {
    const d = dragRef.current;
    if (d?.kind === 'move') move(d.id, i);
    if (d?.kind === 'add') add(d.type, i);
    dragRef.current = null;
    setDropAt(null);
  };

  const el = index >= 0 ? layout[index]! : null;

  return (
    <div
      data-receipt-editor
      className="grid items-start gap-5 xl:grid-cols-[200px_minmax(0,1fr)_300px]"
    >
      {/* ── Add ── */}
      <div className="grid gap-2 xl:sticky xl:top-4">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Add to the receipt
        </p>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
          {ADD_ORDER.map((type) => {
            const Icon = ICONS[type];
            return (
              <button
                key={type}
                type="button"
                draggable
                onDragStart={(e) => {
                  dragRef.current = { kind: 'add', type };
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => setDropAt(null)}
                onClick={() => add(type)}
                title={RECEIPT_ELEMENT_INFO[type].hint}
                className="hover:border-brand/50 hover:bg-accent flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors"
              >
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <span className="font-medium">{RECEIPT_ELEMENT_INFO[type].label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Click to add under the selected piece, or drag onto the paper.
        </p>
      </div>

      {/* ── Paper ── */}
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={history.undo}
            disabled={!history.canUndo}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 /> Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={history.redo}
            disabled={!history.canRedo}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 /> Redo
          </Button>
          <span className="text-muted-foreground ml-2 text-xs">Start from:</span>
          {(Object.keys(RECEIPT_TEMPLATES) as (keyof typeof RECEIPT_TEMPLATES)[]).map((t) => (
            <Button key={t} type="button" size="sm" variant="ghost" onClick={() => setTemplate(t)}>
              {RECEIPT_TEMPLATES[t].label}
            </Button>
          ))}
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => printIt.mutate()}
              disabled={!preview || printIt.isPending}
            >
              <Printer /> Test print
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save
            </Button>
          </div>
        </div>

        <div
          className="bg-muted/60 flex justify-center rounded-xl border p-6"
          onClick={() => (setSelected(null), setEditing(null))}
        >
          <style>{receiptCss('.rp')}</style>
          <div
            className="rp relative w-[302px] bg-white px-[15px] py-3 font-mono text-[12px] leading-[1.35] text-black shadow-lg"
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragRef.current) return;
              const pieces = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-piece]')];
              let at = pieces.length;
              for (let i = 0; i < pieces.length; i++) {
                const r = pieces[i]!.getBoundingClientRect();
                if (e.clientY < r.top + r.height / 2) {
                  at = i;
                  break;
                }
              }
              setDropAt(at);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dropAt !== null) onDropAt(dropAt);
            }}
          >
            {layout.length === 0 && (
              <p className="py-10 text-center text-gray-400">
                Empty receipt. Add pieces from the left.
              </p>
            )}
            {layout.map((piece, i) => (
              <Piece
                key={piece.id}
                el={piece}
                blocks={piecesById.get(piece.id)}
                logo={branding.logo}
                selected={piece.id === selected}
                editing={piece.id === editing}
                dropBefore={dropAt === i}
                onSelect={() => {
                  setSelected(piece.id);
                  if (editing !== piece.id) setEditing(null);
                }}
                onEdit={() => piece.type === 'text' && setEditing(piece.id)}
                onText={(text) => update(piece.id, { text })}
                onDoneEditing={() => setEditing(null)}
                onDragStart={() => {
                  dragRef.current = { kind: 'move', id: piece.id };
                  setSelected(piece.id);
                  setEditing(null);
                }}
                onDragEnd={() => setDropAt(null)}
                onUp={() => move(piece.id, i - 1)}
                onDown={() => move(piece.id, i + 2)}
                onDuplicate={() => duplicate(piece.id)}
                onRemove={() => remove(piece.id)}
                first={i === 0}
                last={i === layout.length - 1}
              />
            ))}
            {dropAt === layout.length && (
              <div className="bg-brand absolute inset-x-2 bottom-1 h-0.5 rounded" />
            )}
          </div>
        </div>
        <p className="text-muted-foreground text-center text-xs">
          {isFetching ? 'Updating…' : 'Shown with your latest bill.'} Click a piece to select it ·
          drag to move · double-click text to type · Delete removes · Ctrl+Z undoes
        </p>
      </div>

      {/* ── Properties ── */}
      <div className="grid gap-4 rounded-xl border bg-card p-4 xl:sticky xl:top-4">
        {el ? (
          <Properties
            key={el.id}
            el={el}
            onChange={(patch) => update(el.id, patch)}
            onRemove={() => remove(el.id)}
          />
        ) : (
          <>
            <div>
              <p className="font-semibold">Receipt</p>
              <p className="text-muted-foreground text-sm">
                Select a piece on the paper to change it.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Copies of every receipt</Label>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant={copies === n ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCopies(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              Shop copy with signature for credit sales
              <Switch checked={shopCopy} onCheckedChange={setShopCopy} />
            </label>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!template}
        onOpenChange={(o) => !o && setTemplate(null)}
        title={`Start from the ${template ? RECEIPT_TEMPLATES[template].label : ''} design?`}
        description="The receipt on the screen is replaced. You can press Undo to get it back."
        confirmText="Use this design"
        onConfirm={() => {
          if (template) set(RECEIPT_TEMPLATES[template].build());
          setSelected(null);
          setTemplate(null);
        }}
      />
    </div>
  );
}

function Piece({
  el,
  blocks,
  logo,
  selected,
  editing,
  dropBefore,
  first,
  last,
  onSelect,
  onEdit,
  onText,
  onDoneEditing,
  onDragStart,
  onDragEnd,
  onUp,
  onDown,
  onDuplicate,
  onRemove,
}: {
  el: ReceiptElement;
  blocks: ReceiptBlock[] | undefined;
  logo: string | null;
  selected: boolean;
  editing: boolean;
  dropBefore: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onText: (text: string) => void;
  onDoneEditing: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const html = blocks?.length ? blocks.map((b) => blockHtml(b, logo)).join('') : '';
  return (
    <div
      data-piece
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      className={cn(
        'group relative -mx-2 cursor-grab rounded px-2 outline-offset-1 active:cursor-grabbing',
        selected
          ? 'outline-brand outline-2 outline'
          : 'hover:outline-brand/40 hover:outline hover:outline-1 hover:outline-dashed',
      )}
    >
      {dropBefore && <div className="bg-brand absolute inset-x-0 -top-1 h-0.5 rounded" />}
      {editing && el.type === 'text' ? (
        <InlineText el={el} onText={onText} onDone={onDoneEditing} />
      ) : html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="py-1 text-center text-[11px] text-gray-400 italic">
          {el.type === 'text'
            ? `${el.text.replace(/\{(\w+)\}/g, (m, k: string) => (k in RECEIPT_FIELDS ? `[${RECEIPT_FIELDS[k as ReceiptField]}]` : m))} (empty now, shows when filled in)`
            : `${RECEIPT_ELEMENT_INFO[el.type].label} (not on this bill)`}
        </div>
      )}
      {selected && !editing && (
        <div className="bg-popover text-popover-foreground absolute top-0 -right-12 z-10 flex flex-col gap-0.5 rounded-lg border p-0.5 font-sans shadow-md">
          <ToolButton icon={GripVertical} label="Drag to move" onClick={() => {}} />
          <ToolButton icon={ArrowUp} label="Move up (Alt+↑)" onClick={onUp} disabled={first} />
          <ToolButton icon={ArrowDown} label="Move down (Alt+↓)" onClick={onDown} disabled={last} />
          <ToolButton icon={Copy} label="Duplicate (Ctrl+D)" onClick={onDuplicate} />
          <ToolButton icon={Trash2} label="Remove (Delete)" onClick={onRemove} danger />
        </div>
      )}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'hover:bg-muted flex size-8 items-center justify-center rounded-md disabled:opacity-30',
        danger && 'text-destructive',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Typing straight on the paper. Enter finishes (Shift+Enter for a new line), Esc too. */
function InlineText({
  el,
  onText,
  onDone,
}: {
  el: Extract<ReceiptElement, { type: 'text' }>;
  onText: (t: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(el.text);
  const finish = () => {
    if (value !== el.text) onText(value);
    onDone();
  };
  return (
    <textarea
      autoFocus
      value={value}
      rows={Math.max(1, value.split('\n').length)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish();
        } else if (e.key === 'Escape') {
          onDone();
        }
      }}
      className={cn(
        'border-brand block w-full resize-none rounded border bg-yellow-50 px-1 font-mono text-black outline-none',
        el.align === 'center' && 'text-center',
        el.align === 'right' && 'text-right',
        el.bold && 'font-bold',
        el.size === 'large' && 'text-[16px]',
      )}
    />
  );
}

function Properties({
  el,
  onChange,
  onRemove,
}: {
  el: ReceiptElement;
  onChange: (patch: Partial<ReceiptElement>) => void;
  onRemove: () => void;
}) {
  const Icon = ICONS[el.type];
  const textRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground size-4" />
        <p className="flex-1 font-semibold">{RECEIPT_ELEMENT_INFO[el.type].label}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive"
          onClick={onRemove}
          aria-label="Remove"
        >
          <Trash2 />
        </Button>
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">{RECEIPT_ELEMENT_INFO[el.type].hint}</p>

      {el.type === 'text' && (
        <>
          <textarea
            ref={textRef}
            value={el.text}
            rows={3}
            onChange={(e) => onChange({ text: e.target.value })}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/40 rounded-md border px-3 py-2 font-mono text-sm outline-none focus-visible:ring-[3px]"
          />
          <div>
            <p className="text-muted-foreground mb-1.5 text-xs">Insert from the bill:</p>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(RECEIPT_FIELDS) as ReceiptField[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    const t = textRef.current;
                    const pos = t ? t.selectionStart : el.text.length;
                    onChange({ text: `${el.text.slice(0, pos)}{${f}}${el.text.slice(pos)}` });
                  }}
                  className="bg-muted hover:bg-accent rounded-full px-2 py-0.5 text-[11px]"
                >
                  {RECEIPT_FIELDS[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['left', AlignLeft],
                ['center', AlignCenter],
                ['right', AlignRight],
              ] as const
            ).map(([a, I]) => (
              <Button
                key={a}
                type="button"
                size="icon-sm"
                variant={el.align === a ? 'default' : 'outline'}
                onClick={() => onChange({ align: a })}
                aria-label={`Align ${a}`}
              >
                <I />
              </Button>
            ))}
            <Button
              type="button"
              size="icon-sm"
              variant={el.bold ? 'default' : 'outline'}
              onClick={() => onChange({ bold: !el.bold })}
              aria-label="Bold"
            >
              <Bold />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={el.size === 'large' ? 'default' : 'outline'}
              onClick={() => onChange({ size: el.size === 'large' ? 'normal' : 'large' })}
            >
              Big
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            A line is left out when all its fields are empty (e.g. no customer).
          </p>
        </>
      )}

      {el.type === 'divider' && (
        <Choice
          value={el.style}
          options={[
            ['dashed', '- - - - -'],
            ['double', '========'],
          ]}
          onChange={(style) => onChange({ style })}
        />
      )}

      {el.type === 'space' && (
        <Choice
          value={String(el.lines)}
          options={[
            ['1', '1 line'],
            ['2', '2 lines'],
            ['3', '3 lines'],
          ]}
          onChange={(v) => onChange({ lines: Number(v) })}
        />
      )}

      {el.type === 'items' && (
        <>
          <Choice
            value={el.layout}
            options={[
              ['two-line', 'Two lines'],
              ['one-line', 'One line'],
            ]}
            onChange={(layout) => onChange({ layout })}
          />
          {(
            [
              ['showWarranty', 'Warranty and end date'],
              ['showSerial', 'Serial number / IMEI'],
              ['showDiscounts', 'Discounts'],
              ['showSku', 'Item code'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-3 text-sm">
              {label}
              <Switch checked={el[k]} onCheckedChange={(v) => onChange({ [k]: v })} />
            </label>
          ))}
        </>
      )}

      {el.type === 'qr' && (
        <div className="grid gap-1.5">
          <Label>Link or text in the QR code</Label>
          <input
            value={el.value}
            onChange={(e) => onChange({ value: e.target.value })}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/40 h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
          />
          <p className="text-muted-foreground text-xs">
            e.g. https://wa.me/94771234567 for WhatsApp. Add a Text piece under it to explain it.
          </p>
        </div>
      )}
    </>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map(([v, label]) => (
        <Button
          key={v}
          type="button"
          size="sm"
          variant={value === v ? 'default' : 'outline'}
          onClick={() => onChange(v)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
