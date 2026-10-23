import { create } from 'zustand';
import { newElementId, type ReceiptElement } from '@shoppos/shared';

/**
 * The receipt editor's state: the design, its history (every change is a named step you can go
 * back to, like the History panel of a photo editor), the selection and the clipboard.
 */

export interface Design {
  layout: ReceiptElement[];
  copies: number;
  shopCopyForCredit: boolean;
}

export interface Step {
  label: string;
  design: Design;
  at: number;
  /** Steps with the same key close together are merged (e.g. typing in a box). */
  mergeKey?: string;
}

/** Which tab of the right-hand dock is open. */
export type DockTab = 'assistant' | 'checks' | 'history';

interface StudioState {
  steps: Step[];
  index: number;
  selected: string[];
  /** Where Shift+click selects from. */
  anchor: string | null;
  editing: string | null;
  clipboard: ReceiptElement[];
  dock: DockTab;
  /** Show the saved design next to the current one. */
  compare: boolean;

  reset: (design: Design) => void;
  /** Make a change: it becomes a new step in the history (and can be undone). */
  commit: (
    label: string,
    next: Partial<Design>,
    opts?: { select?: string[]; mergeKey?: string },
  ) => void;
  undo: () => void;
  redo: () => void;
  jump: (index: number) => void;
  select: (id: string | null, mode?: 'replace' | 'toggle' | 'range') => void;
  setSelected: (ids: string[]) => void;
  setEditing: (id: string | null) => void;
  setDock: (tab: DockTab) => void;
  setCompare: (on: boolean) => void;
  copy: () => void;
  paste: () => void;
}

const MAX_STEPS = 100;
const MERGE_MS = 1500;

export const useStudio = create<StudioState>()((set, get) => ({
  steps: [],
  index: 0,
  selected: [],
  anchor: null,
  editing: null,
  clipboard: [],
  dock: 'assistant',
  compare: false,

  reset(design) {
    set({
      steps: [{ label: 'Opened the receipt', design, at: Date.now() }],
      index: 0,
      selected: [],
      anchor: null,
      editing: null,
      compare: false,
    });
  },

  commit(label, next, opts = {}) {
    const { steps, index } = get();
    const current = steps[index]!;
    const design = { ...current.design, ...next };
    const now = Date.now();
    const merge =
      opts.mergeKey &&
      current.mergeKey === opts.mergeKey &&
      now - current.at < MERGE_MS &&
      index > 0;
    const kept = steps.slice(0, merge ? index : index + 1);
    const step: Step = { label, design, at: now, mergeKey: opts.mergeKey };
    const all = [...kept, step];
    const trimmed =
      all.length > MAX_STEPS ? [all[0]!, ...all.slice(all.length - MAX_STEPS + 1)] : all;
    const ids = new Set(design.layout.map((e) => e.id));
    set((s) => ({
      steps: trimmed,
      index: trimmed.length - 1,
      selected: (opts.select ?? s.selected).filter((id) => ids.has(id)),
    }));
  },

  undo() {
    const { index } = get();
    if (index > 0) get().jump(index - 1);
  },
  redo() {
    const { index, steps } = get();
    if (index < steps.length - 1) get().jump(index + 1);
  },
  jump(index) {
    const step = get().steps[index];
    if (!step) return;
    const ids = new Set(step.design.layout.map((e) => e.id));
    set((s) => ({ index, selected: s.selected.filter((id) => ids.has(id)), editing: null }));
  },

  select(id, mode = 'replace') {
    if (!id) {
      set({ selected: [], anchor: null, editing: null });
      return;
    }
    const { selected, anchor, steps, index } = get();
    if (mode === 'toggle') {
      set({
        selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
        anchor: id,
      });
    } else if (mode === 'range' && anchor) {
      const order = steps[index]!.design.layout.map((e) => e.id);
      const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
      set({ selected: a! < 0 ? [id] : order.slice(a, b! + 1) });
    } else {
      set({ selected: [id], anchor: id });
    }
    if (get().editing !== id) set({ editing: null });
  },
  setSelected(ids) {
    set({ selected: ids, anchor: ids.at(-1) ?? null });
  },
  setEditing(id) {
    set({ editing: id });
  },
  setDock(dock) {
    set({ dock });
  },
  setCompare(compare) {
    set({ compare });
  },

  copy() {
    const { steps, index, selected } = get();
    const layout = steps[index]!.design.layout;
    set({ clipboard: layout.filter((e) => selected.includes(e.id)) });
  },
  paste() {
    const { clipboard, steps, index, selected } = get();
    if (!clipboard.length) return;
    const layout = steps[index]!.design.layout;
    const copies = clipboard.map((e) => ({ ...e, id: newElementId(), locked: undefined }));
    const after = Math.max(-1, ...selected.map((id) => layout.findIndex((e) => e.id === id)));
    const at = after >= 0 ? after + 1 : layout.length;
    get().commit(
      copies.length === 1 ? 'Pasted a piece' : `Pasted ${copies.length} pieces`,
      { layout: [...layout.slice(0, at), ...copies, ...layout.slice(at)] },
      { select: copies.map((e) => e.id) },
    );
  },
}));

/** The design as it is now (the current history step). */
export const useDesign = () => useStudio((s) => s.steps[s.index]?.design);

export const currentDesign = () => {
  const s = useStudio.getState();
  return s.steps[s.index]!.design;
};
