import { ArrowDownUp, Minus, Pencil, Plus } from 'lucide-react';
import type { LayoutChange } from '@shoppos/shared';
import { cn } from '@/lib/utils';

const KIND = {
  added: { icon: Plus, className: 'text-emerald-600', verb: 'Added' },
  removed: { icon: Minus, className: 'text-destructive', verb: 'Removed' },
  changed: { icon: Pencil, className: 'text-amber-600', verb: 'Changed' },
  moved: { icon: ArrowDownUp, className: 'text-sky-600', verb: 'Moved' },
} as const;

/** A list of differences between two receipt designs. */
export function ChangeList({
  changes,
  fromLabel = 'saved',
  toLabel = 'now',
}: {
  changes: LayoutChange[];
  fromLabel?: string;
  toLabel?: string;
}) {
  if (!changes.length)
    return <p className="text-muted-foreground py-4 text-center text-sm">No differences.</p>;
  return (
    <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border text-sm">
      {changes.map((c) => {
        const k = KIND[c.kind];
        return (
          <li key={`${c.kind}-${c.id}`} className="flex gap-2 px-3 py-2">
            <k.icon className={cn('mt-0.5 size-4 shrink-0', k.className)} />
            <div className="min-w-0">
              <p>
                <span className="text-muted-foreground">{k.verb}</span>{' '}
                <span className="font-medium">{c.label}</span>
              </p>
              {c.details?.map((d) => (
                <p key={d} className="text-muted-foreground text-xs">
                  {d.replace(' → ', ` (${fromLabel}) → `)}
                  {` (${toLabel})`}
                </p>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
