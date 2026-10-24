import type { ReactNode } from 'react';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The bottom of a settings form: stays in view while scrolling, says whether everything is saved,
 * and holds Save (and any other buttons on the left).
 */
export function SaveBar({
  dirty,
  count,
  saving,
  canSave = dirty,
  label = 'Save',
  floating = false,
  children,
}: {
  dirty: boolean;
  /** How many settings changed (shown when known). */
  count?: number;
  saving: boolean;
  canSave?: boolean;
  label?: string;
  /** Its own bar under several cards (instead of the bottom of one card). */
  floating?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      data-save-bar
      className={cn(
        'sticky bottom-0 z-10 flex flex-wrap items-center gap-2 px-5 py-3 backdrop-blur transition-colors',
        floating ? 'bottom-3 rounded-xl border shadow-lg' : 'rounded-b-xl border-t',
        dirty ? 'border-amber-300/70 bg-amber-50/95 dark:bg-amber-950/70' : 'bg-card/95',
      )}
    >
      {children}
      <span
        className={cn(
          'ml-auto flex items-center gap-1.5 text-xs',
          dirty ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
        )}
      >
        {dirty ? (
          <>
            <span className="size-1.5 rounded-full bg-amber-500" />
            {count ? `${count} change${count === 1 ? '' : 's'} not saved` : 'Not saved yet'}
          </>
        ) : (
          <>
            <CheckCircle2 className="text-success size-3.5" /> All saved
          </>
        )}
      </span>
      <Button type="submit" disabled={saving || !canSave}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />} {label}
      </Button>
    </div>
  );
}
