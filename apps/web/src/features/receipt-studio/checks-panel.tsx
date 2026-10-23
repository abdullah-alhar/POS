import { useMemo } from 'react';
import { CheckCircle2, CircleAlert, Lightbulb, TriangleAlert, Wand2 } from 'lucide-react';
import { checkReceipt, type ReceiptCheckContext, type ReceiptIssue } from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { replaceLayout } from './actions';
import { currentDesign, useStudio, type Design } from './store';

const LEVEL = {
  error: { icon: CircleAlert, className: 'text-destructive', label: 'Problem' },
  warning: {
    icon: TriangleAlert,
    className: 'text-amber-600 dark:text-warning',
    label: 'Check this',
  },
  tip: { icon: Lightbulb, className: 'text-sky-600 dark:text-sky-400', label: 'Tip' },
} as const;

export function useChecks(design: Design | undefined, ctx: ReceiptCheckContext) {
  return useMemo(() => (design ? checkReceipt(design.layout, ctx) : []), [design, ctx]);
}

function applyFix(issue: ReceiptIssue) {
  if (!issue.fix) return;
  const next = issue.fix.apply(currentDesign().layout);
  replaceLayout(`Fixed: ${issue.title}`, next);
}

/** The design check: problems first, each with "Show" and a one-click fix when there is one. */
export function ChecksPanel({ issues }: { issues: ReceiptIssue[] }) {
  const fixable = issues.filter((i) => i.fix && i.level !== 'tip');

  if (!issues.length) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
        <CheckCircle2 className="text-success size-10" />
        <p className="text-foreground font-medium">Everything looks right</p>
        <p>The receipt has the items, total, payment and bill number.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {fixable.length > 1 && (
        <Button
          size="sm"
          onClick={() => {
            let layout = currentDesign().layout;
            for (const issue of fixable) layout = issue.fix!.apply(layout);
            replaceLayout(`Fixed ${fixable.length} problems`, layout);
          }}
        >
          <Wand2 /> Fix all {fixable.length} problems
        </Button>
      )}
      <ul className="grid gap-2">
        {issues.map((issue) => {
          const level = LEVEL[issue.level];
          return (
            <li key={issue.id} className="bg-card rounded-lg border p-2.5">
              <div className="flex gap-2">
                <level.icon className={cn('mt-0.5 size-4 shrink-0', level.className)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug font-medium">{issue.title}</p>
                  {issue.detail && (
                    <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                      {issue.detail}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {issue.fix && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => applyFix(issue)}
                      >
                        <Wand2 /> {issue.fix.label}
                      </Button>
                    )}
                    {issue.elementId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => {
                          useStudio.getState().select(issue.elementId!);
                          document
                            .querySelector(`[data-paper] [data-id="${issue.elementId}"]`)
                            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }}
                      >
                        Show
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
