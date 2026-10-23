import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Filter,
  Lock,
  Trash2,
  Unlock,
  type LucideIcon,
} from 'lucide-react';
import {
  diffLayouts,
  prettyFields,
  RECEIPT_CONDITIONS,
  RECEIPT_ELEMENT_INFO,
  type LayoutChange,
  type ReceiptCondition,
  type ReceiptElement,
  type ReceiptElementType,
} from '@shoppos/shared';
import { useBranding } from '@/lib/branding';
import { cn } from '@/lib/utils';
import { blockHtml, receiptCss } from '../receipts/receipt-html';
import {
  addPiece,
  duplicatePieces,
  movePieces,
  nudgePieces,
  removePieces,
  toggleHidden,
  toggleLocked,
  updatePieces,
} from './actions';
import { useStudio, type Design } from './store';
import { useReceiptPreview, type PreviewPiece, type PreviewView } from './use-preview';

/** What is being dragged: pieces on the paper, or a new piece from the Add tools. */
export const dragState: {
  current: { kind: 'move'; ids: string[] } | { kind: 'add'; type: ReceiptElementType } | null;
} = { current: null };

const PAPER = {
  48: { width: 302, pad: 15, label: '80 mm' },
  42: { width: 280, pad: 14, label: '80 mm (42)' },
  32: { width: 219, pad: 10, label: '58 mm' },
} as const;

const CHANGE_RING: Record<LayoutChange['kind'], string> = {
  added: 'ring-2 ring-emerald-500',
  changed: 'ring-2 ring-amber-500',
  moved: 'ring-2 ring-sky-500',
  removed: 'ring-2 ring-red-500',
};

export function Canvas({
  design,
  saved,
  preview,
  view,
  zoom,
  printerView,
}: {
  design: Design;
  saved: Design;
  preview: ReturnType<typeof useReceiptPreview>;
  view: PreviewView;
  zoom: number;
  printerView: boolean;
}) {
  const compare = useStudio((s) => s.compare);
  const changes = useMemo(
    () => (compare ? diffLayouts(saved.layout, design.layout) : []),
    [compare, saved.layout, design.layout],
  );

  return (
    <div
      className="bg-muted/60 relative flex min-h-full items-start justify-center gap-28 px-24 py-8"
      onClick={() => useStudio.getState().select(null)}
    >
      {compare && <ComparePaper saved={saved} view={view} zoom={zoom} changes={changes} />}
      <div className="grid justify-items-center gap-2">
        {compare && (
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Now (not saved)
          </p>
        )}
        {printerView ? (
          <PrinterText text={preview.data?.text ?? ''} width={view.charsPerLine} zoom={zoom} />
        ) : (
          <Paper
            design={design}
            pieces={preview.piecesById}
            view={view}
            zoom={zoom}
            changes={changes}
          />
        )}
        <p className="text-muted-foreground mt-1 text-center text-xs">
          {preview.isError
            ? (preview.error as Error).message
            : preview.isFetching || preview.stale
              ? 'Updating…'
              : preview.data && status(preview.data)}
        </p>
      </div>
    </div>
  );
}

/** "Sample bill · 2 receipts (with shop copy) · about 40 cm of paper". */
function status(data: NonNullable<ReturnType<typeof useReceiptPreview>['data']>) {
  const receipts = data.doc.blocks.filter((b) => b.type === 'cut').length + 1;
  const shopCopy = data.text.includes('*** SHOP COPY ***');
  return [
    data.bill.source === 'sample' ? 'Sample bill' : data.bill.number,
    receipts > 1 &&
      `prints ${receipts} receipts${shopCopy ? ' (with the shop copy)' : ''}, the first is shown`,
    `about ${Math.round(data.estimate.mm / 10)} cm of paper`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The saved design, with removed pieces marked, next to the current one. */
function ComparePaper({
  saved,
  view,
  zoom,
  changes,
}: {
  saved: Design;
  view: PreviewView;
  zoom: number;
  changes: LayoutChange[];
}) {
  const preview = useReceiptPreview(saved, view);
  const removed = useMemo(
    () => new Map(changes.filter((c) => c.kind === 'removed').map((c) => [c.id, c])),
    [changes],
  );
  return (
    <div className="grid justify-items-center gap-2 opacity-90">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Saved</p>
      <Paper
        design={saved}
        pieces={preview.piecesById}
        view={view}
        zoom={zoom}
        readOnly
        marks={removed}
      />
    </div>
  );
}

/** Exactly what the receipt printer prints, with a ruler of letter positions. */
function PrinterText({ text, width, zoom }: { text: string; width: number; zoom: number }) {
  const ruler = Array.from({ length: width }, (_, i) =>
    (i + 1) % 10 === 0 ? String((i + 1) / 10) : (i + 1) % 5 === 0 ? '+' : '·',
  ).join('');
  return (
    <div
      style={{ zoom }}
      className="bg-white px-3 py-3 text-black shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <pre className="border-b border-dashed border-gray-300 pb-1 font-mono text-[12px] leading-[1.35] text-gray-400">
        {ruler}
      </pre>
      <pre className="font-mono text-[12px] leading-[1.35] whitespace-pre">{text || ' '}</pre>
    </div>
  );
}

function Paper({
  design,
  pieces,
  view,
  zoom,
  changes = [],
  readOnly,
  marks,
}: {
  design: Design;
  pieces: Map<string, PreviewPiece>;
  view: PreviewView;
  zoom: number;
  changes?: LayoutChange[];
  readOnly?: boolean;
  marks?: Map<string, LayoutChange>;
}) {
  const branding = useBranding();
  const selected = useStudio((s) => s.selected);
  const editing = useStudio((s) => s.editing);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const paper = PAPER[view.charsPerLine];
  const changeById = useMemo(() => new Map(changes.map((c) => [c.id, c])), [changes]);
  const { layout } = design;

  const onDrop = (at: number) => {
    const d = dragState.current;
    if (d?.kind === 'move') movePieces(d.ids, at);
    if (d?.kind === 'add') addPiece(d.type, at);
    dragState.current = null;
    setDropAt(null);
  };

  return (
    <div style={{ zoom }}>
      <style>{receiptCss('.rp')}</style>
      <div
        ref={paperRef}
        data-paper
        className="rp relative bg-white py-3 font-mono text-[12px] leading-[1.35] text-black shadow-lg"
        style={{ width: paper.width, paddingInline: paper.pad }}
        onDragOver={(e) => {
          if (readOnly || !dragState.current) return;
          e.preventDefault();
          const els = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > [data-piece]')];
          let at = els.length;
          for (let i = 0; i < els.length; i++) {
            const r = els[i]!.getBoundingClientRect();
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
          if (dropAt !== null) onDrop(dropAt);
        }}
      >
        {layout.length === 0 && (
          <p className="py-10 text-center font-sans text-gray-400">
            Empty receipt. Add pieces from the left, or ask the assistant.
          </p>
        )}
        {layout.map((el, i) => (
          <Piece
            key={el.id}
            el={el}
            piece={pieces.get(el.id)}
            logo={branding.logo}
            selected={!readOnly && selected.includes(el.id)}
            single={selected.length === 1}
            editing={!readOnly && editing === el.id}
            dropBefore={dropAt === i}
            change={changeById.get(el.id) ?? marks?.get(el.id)}
            readOnly={readOnly}
            first={i === 0}
            last={i === layout.length - 1}
          />
        ))}
        {dropAt === layout.length && (
          <div className="bg-brand absolute inset-x-2 bottom-1 h-0.5 rounded" />
        )}
      </div>
    </div>
  );
}

function Piece({
  el,
  piece,
  logo,
  selected,
  single,
  editing,
  dropBefore,
  change,
  readOnly,
  first,
  last,
}: {
  el: ReceiptElement;
  piece: PreviewPiece | undefined;
  logo: string | null;
  selected: boolean;
  single: boolean;
  editing: boolean;
  dropBefore: boolean;
  change?: LayoutChange;
  readOnly?: boolean;
  first: boolean;
  last: boolean;
}) {
  const html = piece?.blocks.length ? piece.blocks.map((b) => blockHtml(b, logo)).join('') : '';
  const skipped = el.hidden ? 'hidden' : piece?.skipped;
  const ids = () => {
    const sel = useStudio.getState().selected;
    return sel.includes(el.id) ? sel : [el.id];
  };

  return (
    <div
      data-piece
      data-id={el.id}
      draggable={!readOnly && !editing && !el.locked}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        if (!useStudio.getState().selected.includes(el.id)) useStudio.getState().select(el.id);
        dragState.current = { kind: 'move', ids: ids() };
        useStudio.getState().setEditing(null);
      }}
      onDragEnd={() => (dragState.current = null)}
      onClick={(e) => {
        e.stopPropagation();
        if (readOnly) return;
        useStudio
          .getState()
          .select(el.id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!readOnly && el.type === 'text' && !el.locked) useStudio.getState().setEditing(el.id);
      }}
      className={cn(
        'group relative -mx-2 rounded px-2 outline-offset-1',
        !readOnly && !el.locked && 'cursor-grab active:cursor-grabbing',
        selected
          ? 'outline-brand outline outline-2'
          : !readOnly &&
              'hover:outline-brand/40 hover:outline hover:outline-1 hover:outline-dashed',
        change && CHANGE_RING[change.kind],
        change?.kind === 'removed' && 'opacity-60 line-through',
      )}
    >
      {dropBefore && <div className="bg-brand absolute inset-x-0 -top-1 h-0.5 rounded" />}
      <div className={cn(skipped && 'opacity-35')}>
        {editing && el.type === 'text' ? (
          <InlineText el={el} />
        ) : html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="py-1 text-center font-sans text-[11px] text-gray-400 italic">
            {el.type === 'text'
              ? `${prettyFields(el.text) || 'Empty text'} (empty on this bill)`
              : `${RECEIPT_ELEMENT_INFO[el.type].label} (not on this bill)`}
          </div>
        )}
      </div>
      {(skipped || el.locked || el.when) && (
        // In the margin left of the paper, so the receipt itself stays readable.
        <div
          className="absolute top-0 right-full mr-2 flex flex-col items-end gap-0.5 font-sans"
          title={
            el.when
              ? `Printed only when: ${RECEIPT_CONDITIONS[el.when].toLowerCase()}${skipped === 'condition' ? ' (not on this bill)' : ''}`
              : undefined
          }
        >
          {el.locked && <Tag icon={Lock}>Locked</Tag>}
          {skipped === 'hidden' ? (
            <Tag icon={EyeOff}>Hidden</Tag>
          ) : el.when ? (
            <Tag icon={Filter} muted={skipped === 'condition'}>
              {CONDITION_SHORT[el.when]}
            </Tag>
          ) : null}
        </div>
      )}
      {selected && single && !editing && (
        <div className="bg-popover text-popover-foreground absolute top-0 -right-12 z-10 flex flex-col gap-0.5 rounded-lg border p-0.5 font-sans shadow-md">
          <ToolButton
            icon={ArrowUp}
            label="Move up (Alt+↑)"
            onClick={() => nudgePieces([el.id], -1)}
            disabled={first || el.locked}
          />
          <ToolButton
            icon={ArrowDown}
            label="Move down (Alt+↓)"
            onClick={() => nudgePieces([el.id], 1)}
            disabled={last || el.locked}
          />
          <ToolButton
            icon={Copy}
            label="Duplicate (Ctrl+D)"
            onClick={() => duplicatePieces([el.id])}
          />
          <ToolButton
            icon={el.hidden ? Eye : EyeOff}
            label={el.hidden ? 'Show (Ctrl+E)' : 'Hide (Ctrl+E)'}
            onClick={() => toggleHidden([el.id])}
            disabled={el.locked}
          />
          <ToolButton
            icon={el.locked ? Unlock : Lock}
            label={el.locked ? 'Unlock' : 'Lock'}
            onClick={() => toggleLocked([el.id])}
          />
          <ToolButton
            icon={Trash2}
            label="Remove (Delete)"
            onClick={() => removePieces([el.id])}
            danger
            disabled={el.locked}
          />
        </div>
      )}
    </div>
  );
}

/** Short names for "print only when …", for the tags beside the paper. */
const CONDITION_SHORT: Record<ReceiptCondition, string> = {
  always: 'Always',
  customer: 'Customer',
  noCustomer: 'No customer',
  cash: 'Cash',
  card: 'Card',
  credit: 'Credit',
  discount: 'Discount',
  warranty: 'Warranty',
  wholesale: 'Wholesale',
  retail: 'Retail',
  notQuote: 'Not quotes',
  quote: 'Quotes',
  reprint: 'Reprints',
};

function Tag({
  icon: Icon,
  muted,
  children,
}: {
  icon?: LucideIcon;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-medium whitespace-nowrap',
        muted ? 'bg-muted text-muted-foreground border' : 'bg-gray-800/85 text-white',
      )}
    >
      {Icon && <Icon className="size-2.5" />}
      {children}
    </span>
  );
}

export function ToolButton({
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

/** Typing straight on the paper. Enter finishes (Shift+Enter for a new line), Esc cancels. */
function InlineText({ el }: { el: Extract<ReceiptElement, { type: 'text' }> }) {
  const [value, setValue] = useState(el.text);
  const done = () => useStudio.getState().setEditing(null);
  const finish = () => {
    if (value !== el.text) updatePieces([el.id], { text: value }, 'Typed text');
    done();
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
          done();
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
