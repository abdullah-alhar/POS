import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, LayoutTemplate, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  diffLayouts,
  newElementId,
  RECEIPT_ELEMENT_INFO,
  RECEIPT_TEMPLATES,
  summarizeChanges,
  type AllSettings,
  type ReceiptElement,
  type ReceiptLibrary,
} from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';
import { replaceLayout } from './actions';
import { PIECE_ICONS } from './icons';
import { currentDesign } from './store';

/** Small row of icons that sketches a design (what pieces it has, in order). */
function Sketch({ layout }: { layout: ReceiptElement[] }) {
  return (
    <div className="text-muted-foreground flex flex-wrap gap-0.5">
      {layout.slice(0, 24).map((el) => {
        const Icon = PIECE_ICONS[el.type];
        return (
          <Icon key={el.id} className="size-3" aria-label={RECEIPT_ELEMENT_INFO[el.type].label} />
        );
      })}
    </div>
  );
}

/**
 * Start from a ready-made design, or switch to one of the shop's own saved designs
 * (e.g. "Normal" and "Eid sale"), and save the current design by name.
 */
export function LibraryDialog({
  open,
  onOpenChange,
  library,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: ReceiptLibrary;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: (next: ReceiptLibrary) => api.put<ReceiptLibrary>('/settings/receiptLibrary', next),
    onSuccess: (value) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) =>
        old ? { ...old, receiptLibrary: value } : old,
      );
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save'),
  });

  const use = (label: string, layout: ReceiptElement[]) => {
    // Fresh ids, so the history can tell the pieces of the new design apart.
    const fresh = layout.map((e) => ({ ...e, id: newElementId() }));
    replaceLayout(label, fresh);
    onOpenChange(false);
    toast.success(`${label}. Press Undo to go back.`);
  };

  const now = open ? currentDesign().layout : [];
  const saveAs = () => {
    const n = name.trim();
    if (!n) return;
    const others = library.designs.filter((d) => d.name.toLowerCase() !== n.toLowerCase());
    const design = { id: newElementId(), name: n, savedAt: new Date().toISOString(), layout: now };
    save.mutate(
      { designs: [design, ...others].slice(0, 20) },
      {
        onSuccess: () => {
          setName('');
          toast.success(`Saved "${n}" in My designs`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Designs</DialogTitle>
          <DialogDescription>
            Start from a ready-made design or one you saved. The receipt on the screen is replaced;
            Undo brings it back.
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <LayoutTemplate className="size-4" /> Ready-made
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(RECEIPT_TEMPLATES) as (keyof typeof RECEIPT_TEMPLATES)[]).map((key) => {
              const tpl = RECEIPT_TEMPLATES[key];
              const layout = tpl.build();
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => use(`Started from the ${tpl.label} design`, layout)}
                  className="hover:border-brand/60 hover:bg-accent/40 bg-card grid gap-1.5 rounded-lg border p-3 text-left transition-colors"
                >
                  <span className="font-medium">{tpl.label}</span>
                  <span className="text-muted-foreground text-xs leading-snug">{tpl.hint}</span>
                  <Sketch layout={layout} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <BookmarkPlus className="size-4" /> My designs
          </h3>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveAs();
            }}
          >
            <Input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Save the current design as… e.g. Eid sale"
            />
            <Button type="submit" disabled={!name.trim() || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <BookmarkPlus />} Save
            </Button>
          </form>
          {library.designs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No saved designs yet. Save one to switch between designs (e.g. for a sale season).
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {library.designs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{d.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(d.savedAt).toLocaleDateString()} · {d.layout.length} pieces ·{' '}
                      {summarizeChanges(diffLayouts(now, d.layout)).toLowerCase()} vs. now
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => use(`Switched to "${d.name}"`, d.layout)}
                  >
                    Use
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${d.name}`}
                    onClick={() =>
                      save.mutate({ designs: library.designs.filter((x) => x.id !== d.id) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
