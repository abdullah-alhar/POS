import { toast } from 'sonner';
import {
  describeElement,
  newElementId,
  newReceiptElement,
  RECEIPT_ELEMENT_INFO,
  type ReceiptElement,
  type ReceiptElementType,
} from '@shoppos/shared';
import { currentDesign, useStudio } from './store';

/**
 * Editing actions, shared by the paper, the layers panel, the keyboard and the assistant.
 * Locked pieces are never moved, changed or removed (unlock them first).
 */

const layout = () => currentDesign().layout;
const state = () => useStudio.getState();
const name = (ids: string[]) => {
  if (ids.length !== 1) return `${ids.length} pieces`;
  const el = layout().find((e) => e.id === ids[0]);
  return el ? `"${describeElement(el)}"` : 'piece';
};

function unlocked(ids: string[]) {
  const locked = layout().filter((e) => ids.includes(e.id) && e.locked);
  if (locked.length) {
    toast.info(
      locked.length === 1
        ? `"${describeElement(locked[0]!)}" is locked. Unlock it to change it.`
        : `${locked.length} locked pieces were left as they are.`,
      { id: 'locked' },
    );
  }
  return ids.filter((id) => !locked.some((e) => e.id === id));
}

/** Add a new piece at `at`, or under the selected piece, or at the end. */
export function addPiece(type: ReceiptElementType, at?: number) {
  const el = newReceiptElement(type);
  const cur = layout();
  const sel = state().selected;
  const last = Math.max(-1, ...sel.map((id) => cur.findIndex((e) => e.id === id)));
  const pos = at ?? (last >= 0 ? last + 1 : cur.length);
  state().commit(
    `Added ${RECEIPT_ELEMENT_INFO[type].label.toLowerCase()}`,
    { layout: [...cur.slice(0, pos), el, ...cur.slice(pos)] },
    { select: [el.id] },
  );
  if (type === 'text') state().setEditing(el.id);
}

export function removePieces(ids: string[]) {
  const ok = unlocked(ids);
  if (!ok.length) return;
  const cur = layout();
  const firstIndex = cur.findIndex((e) => ok.includes(e.id));
  const rest = cur.filter((e) => !ok.includes(e.id));
  const next = rest[Math.min(firstIndex, rest.length - 1)];
  state().commit(`Removed ${name(ok)}`, { layout: rest }, { select: next ? [next.id] : [] });
  state().setEditing(null);
}

export function duplicatePieces(ids: string[]) {
  if (!ids.length) return;
  const cur = layout();
  const picked = cur.filter((e) => ids.includes(e.id));
  const copies = picked.map((e) => ({ ...e, id: newElementId(), locked: undefined }));
  const after = Math.max(...picked.map((e) => cur.indexOf(e)));
  state().commit(
    `Duplicated ${name(ids)}`,
    { layout: [...cur.slice(0, after + 1), ...copies, ...cur.slice(after + 1)] },
    { select: copies.map((e) => e.id) },
  );
}

/** Move pieces so they start at position `to` (counted in the design before the move). */
export function movePieces(ids: string[], to: number) {
  const ok = unlocked(ids);
  if (!ok.length) return;
  const cur = layout();
  const moving = cur.filter((e) => ok.includes(e.id));
  const before = cur.slice(0, to).filter((e) => !ok.includes(e.id)).length;
  const rest = cur.filter((e) => !ok.includes(e.id));
  const next = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
  if (next.every((e, i) => e === cur[i])) return;
  state().commit(`Moved ${name(ok)}`, { layout: next });
}

/** One place up (-1) or down (+1). */
export function nudgePieces(ids: string[], delta: -1 | 1) {
  const cur = layout();
  const idx = cur.map((e, i) => (ids.includes(e.id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return;
  if (delta < 0 && idx[0] === 0) return;
  if (delta > 0 && idx.at(-1) === cur.length - 1) return;
  movePieces(ids, delta < 0 ? idx[0]! - 1 : idx.at(-1)! + 2);
}

/** Change options of pieces. Typing into a box merges into one history step. */
export function updatePieces(
  ids: string[],
  patch: Partial<ReceiptElement> | ((el: ReceiptElement) => Partial<ReceiptElement>),
  label: string,
  mergeKey?: string,
) {
  const ok = unlocked(ids);
  if (!ok.length) return;
  state().commit(
    label,
    {
      layout: layout().map((e) => {
        if (!ok.includes(e.id)) return e;
        const next = { ...e, ...(typeof patch === 'function' ? patch(e) : patch) } as Record<
          string,
          unknown
        >;
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next as ReceiptElement;
      }),
    },
    { mergeKey },
  );
}

export function toggleHidden(ids: string[]) {
  const els = layout().filter((e) => ids.includes(e.id));
  if (!els.length) return;
  const hide = els.some((e) => !e.hidden);
  updatePieces(ids, { hidden: hide || undefined }, `${hide ? 'Hid' : 'Showed'} ${name(ids)}`);
}

export function toggleLocked(ids: string[]) {
  const els = layout().filter((e) => ids.includes(e.id));
  if (!els.length) return;
  const lock = els.some((e) => !e.locked);
  // Unlocking must work on locked pieces, so it does not go through updatePieces.
  state().commit(`${lock ? 'Locked' : 'Unlocked'} ${name(ids)}`, {
    layout: layout().map((e) => (ids.includes(e.id) ? { ...e, locked: lock || undefined } : e)),
  });
}

/** Replace the whole design (template, saved design, import, assistant, a fix). */
export function replaceLayout(label: string, next: ReceiptElement[], select: string[] = []) {
  state().commit(label, { layout: next }, { select });
}

export function selectAll() {
  state().setSelected(layout().map((e) => e.id));
}
