import { useState } from 'react';
import { Eye, EyeOff, Filter, Lock, Unlock } from 'lucide-react';
import {
  describeElement,
  prettyFields,
  RECEIPT_CONDITIONS,
  RECEIPT_ELEMENT_INFO,
  type ReceiptElement,
} from '@shoppos/shared';
import { cn } from '@/lib/utils';
import { addPiece, movePieces, toggleHidden, toggleLocked, updatePieces } from './actions';
import { dragState } from './canvas';
import { ADD_ORDER, PIECE_ICONS } from './icons';
import { useStudio } from './store';

/** The "Add" tools: click to add under the selected piece, or drag onto the paper. */
export function AddTools() {
  return (
    <section className="grid gap-2">
      <h3 className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        Add
      </h3>
      <div className="grid grid-cols-3 gap-1.5">
        {ADD_ORDER.map((type) => {
          const Icon = PIECE_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              draggable
              onDragStart={(e) => {
                dragState.current = { kind: 'add', type };
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDragEnd={() => (dragState.current = null)}
              onClick={() => addPiece(type)}
              title={`${RECEIPT_ELEMENT_INFO[type].label}: ${RECEIPT_ELEMENT_INFO[type].hint}`}
              className="hover:border-brand/50 hover:bg-accent bg-card flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] leading-tight font-medium transition-colors"
            >
              <Icon className="text-muted-foreground size-4" />
              <span className="w-full truncate text-center">
                {RECEIPT_ELEMENT_INFO[type].label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Every piece of the receipt as a layer, top to bottom: click to select (Ctrl/Shift for more),
 * drag to reorder, the eye hides it from printing, the lock protects it, double-click to rename.
 */
export function LayersPanel({ layout }: { layout: ReceiptElement[] }) {
  const selected = useStudio((s) => s.selected);
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const q = filter.trim().toLowerCase();
  const shown = layout
    .map((el, index) => ({ el, index }))
    .filter(
      ({ el }) =>
        !q ||
        describeElement(el).toLowerCase().includes(q) ||
        RECEIPT_ELEMENT_INFO[el.type].label.toLowerCase().includes(q),
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          Layers · {layout.length}
        </h3>
        <span className="text-muted-foreground text-[11px]">
          {selected.length > 1 && `${selected.length} selected`}
        </span>
      </div>
      <label className="bg-card focus-within:border-ring flex h-8 items-center gap-1.5 rounded-md border px-2">
        <Filter className="text-muted-foreground size-3.5" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a layer"
          className="w-full bg-transparent text-xs outline-none"
        />
      </label>
      <ol
        className="bg-card min-h-0 flex-1 overflow-y-auto rounded-lg border"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
        }}
      >
        {shown.map(({ el, index }) => {
          const Icon = PIECE_ICONS[el.type];
          const isSel = selected.includes(el.id);
          return (
            <li
              key={el.id}
              draggable={!el.locked && renaming !== el.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                const sel = useStudio.getState().selected;
                dragState.current = { kind: 'move', ids: sel.includes(el.id) ? sel : [el.id] };
              }}
              onDragEnd={() => {
                dragState.current = null;
                setDropAt(null);
              }}
              onDragOver={(e) => {
                if (!dragState.current) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const d = dragState.current;
                if (d && dropAt !== null) {
                  if (d.kind === 'move') movePieces(d.ids, dropAt);
                  else addPiece(d.type, dropAt);
                }
                dragState.current = null;
                setDropAt(null);
              }}
              onClick={(e) =>
                useStudio
                  .getState()
                  .select(
                    el.id,
                    e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace',
                  )
              }
              onDoubleClick={() => setRenaming(el.id)}
              className={cn(
                'group relative flex h-9 cursor-pointer items-center gap-2 border-b px-2 text-xs last:border-b-0',
                isSel ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                el.hidden && 'text-muted-foreground',
                dropAt === index && 'shadow-[inset_0_2px_0_var(--brand)]',
                dropAt === index + 1 &&
                  index === layout.length - 1 &&
                  'shadow-[inset_0_-2px_0_var(--brand)]',
              )}
            >
              <Icon className="size-3.5 shrink-0 opacity-70" />
              {renaming === el.id ? (
                <input
                  autoFocus
                  defaultValue={el.name ?? ''}
                  placeholder={describeElement({ ...el, name: undefined })}
                  maxLength={40}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name !== (el.name ?? ''))
                      updatePieces([el.id], { name: name || undefined }, 'Renamed a layer');
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="bg-background h-6 min-w-0 flex-1 rounded border px-1 outline-none"
                />
              ) : (
                <span
                  className={cn('min-w-0 flex-1 truncate', el.hidden && 'line-through')}
                  title={el.type === 'text' ? prettyFields(el.text) : describeElement(el)}
                >
                  {describeElement(el)}
                </span>
              )}
              {el.when && (
                <span
                  className="bg-muted text-muted-foreground shrink-0 rounded px-1 text-[9px]"
                  title={`Printed only when: ${RECEIPT_CONDITIONS[el.when]}`}
                >
                  if
                </span>
              )}
              <LayerToggle
                on={!!el.locked}
                onClick={() => toggleLocked([el.id])}
                label={el.locked ? 'Unlock' : 'Lock'}
                iconOn={Lock}
                iconOff={Unlock}
              />
              <LayerToggle
                on={!el.hidden}
                always
                onClick={() => toggleHidden([el.id])}
                label={el.hidden ? 'Show (print it)' : 'Hide (do not print)'}
                iconOn={Eye}
                iconOff={EyeOff}
              />
            </li>
          );
        })}
        {!shown.length && (
          <li className="text-muted-foreground p-4 text-center text-xs">
            {layout.length ? 'No layer matches' : 'No pieces yet'}
          </li>
        )}
      </ol>
      <p className="text-muted-foreground text-[11px] leading-snug">
        Ctrl+click or Shift+click selects more. Double-click to rename.
      </p>
    </section>
  );
}

function LayerToggle({
  on,
  always,
  onClick,
  label,
  iconOn: On,
  iconOff: Off,
}: {
  on: boolean;
  /** Show the button even when not hovered (the eye). */
  always?: boolean;
  onClick: () => void;
  label: string;
  iconOn: typeof Eye;
  iconOff: typeof Eye;
}) {
  const Icon = on ? On : Off;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'hover:bg-background flex size-6 shrink-0 items-center justify-center rounded',
        !always && !on && 'opacity-0 group-hover:opacity-60',
        always && !on && 'opacity-60',
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
