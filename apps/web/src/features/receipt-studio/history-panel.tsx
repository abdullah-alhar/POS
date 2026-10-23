import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitCompareArrows, History, RotateCcw } from 'lucide-react';
import {
  diffLayouts,
  receiptSettingsSchema,
  summarizeChanges,
  type SettingsVersionDto,
} from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ChangeList } from './change-list';
import { currentDesign, useStudio, type Design } from './store';

const time = (at: number | string) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Two kinds of history: the steps of this editing session (click one to go back to it, like a
 * photo editor) and every saved version of the receipt (compare with now, or bring it back).
 */
export function HistoryPanel() {
  const steps = useStudio((s) => s.steps);
  const index = useStudio((s) => s.index);
  const [version, setVersion] = useState<{ v: SettingsVersionDto; design: Design } | null>(null);
  const { data: versions = [], isPending } = useQuery({
    queryKey: ['settings-history', 'receipt'],
    queryFn: () => api.get<SettingsVersionDto[]>('/settings/history?section=receipt&limit=30'),
  });

  return (
    <div className="grid gap-4">
      <section className="grid gap-1.5">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          This session · click a step to go back
        </p>
        <ol className="bg-card max-h-72 overflow-y-auto rounded-lg border">
          {steps.map((step, i) => (
            <li key={`${i}-${step.at}`}>
              <button
                type="button"
                onClick={() => useStudio.getState().jump(i)}
                className={cn(
                  'flex w-full items-center gap-2 border-b px-2.5 py-1.5 text-left text-xs last:border-b-0',
                  i === index
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'hover:bg-muted/60',
                  i > index && 'text-muted-foreground italic',
                )}
              >
                <span className="text-muted-foreground w-5 shrink-0 tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{step.label}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">{time(step.at)}</span>
              </button>
            </li>
          ))}
        </ol>
        {index < steps.length - 1 && (
          <p className="text-muted-foreground text-[11px]">
            Steps in grey are undone. A new change removes them.
          </p>
        )}
      </section>

      <section className="grid gap-1.5">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          Saved versions
        </p>
        {isPending ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Each time the receipt is saved, the earlier version is kept here.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {versions.map((v) => {
              const parsed = receiptSettingsSchema.safeParse(v.before);
              return (
                <li key={v.id} className="bg-card rounded-lg border p-2 text-xs">
                  <p className="font-medium">
                    {new Date(v.createdAt).toLocaleString([], {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {v.userName && <span className="text-muted-foreground"> · {v.userName}</span>}
                  </p>
                  <p className="text-muted-foreground line-clamp-2">{v.summary}</p>
                  {parsed.success && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-7"
                      onClick={() =>
                        setVersion({
                          v,
                          design: {
                            layout: parsed.data.layout,
                            copies: parsed.data.copies,
                            shopCopyForCredit: parsed.data.shopCopyForCredit,
                          },
                        })
                      }
                    >
                      <History /> Before this change
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <VersionDialog version={version} onClose={() => setVersion(null)} />
    </div>
  );
}

function VersionDialog({
  version,
  onClose,
}: {
  version: { v: SettingsVersionDto; design: Design } | null;
  onClose: () => void;
}) {
  const now = version ? currentDesign() : null;
  const changes = version && now ? diffLayouts(version.design.layout, now.layout) : [];
  return (
    <Dialog open={!!version} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <GitCompareArrows className="mr-2 inline size-5" />
            Earlier version
          </DialogTitle>
          <DialogDescription>
            {version &&
              `As it was before ${new Date(version.v.createdAt).toLocaleString()}. Compared with the receipt on the screen now: ${summarizeChanges(changes).toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>
        <ChangeList changes={changes} fromLabel="then" toLabel="now" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => {
              if (!version) return;
              useStudio
                .getState()
                .commit(
                  `Brought back the version from ${new Date(version.v.createdAt).toLocaleDateString()}`,
                  version.design,
                  { select: [] },
                );
              onClose();
            }}
          >
            <RotateCcw /> Use this version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
