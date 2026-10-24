import {
  ChevronRight,
  CircleAlert,
  Lightbulb,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import {
  checkSettings,
  formatSetting,
  type AllSettings,
  type SettingsIssue,
} from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AiOrb } from '../assistant/ai-orb';
import { useAssistantStatus } from '../assistant/assistant-chat';
import { SettingsAssistant } from './settings-assistant';
import { ISSUE_PAGE, PAGES, type PageId } from './settings-pages';

/** One line about how each section is set now, for the overview tiles. */
function summary(id: PageId, settings: AllSettings): string {
  switch (id) {
    case 'shop':
      return settings.shop.name || 'No shop name yet';
    case 'receipt':
      return `${settings.receipt.layout.length} pieces · ${formatSetting('receipt.copies', settings.receipt.copies)} cop${settings.receipt.copies === 1 ? 'y' : 'ies'}`;
    case 'printer':
      return formatSetting('printer.mode', settings.printer.mode);
    case 'billing':
      return `Totals: ${formatSetting('pos.roundingStep', settings.pos.roundingStep).toLowerCase()}`;
    case 'approvals':
      return `Cashiers: up to ${formatSetting('approvals.cashierMaxDiscountBp', settings.approvals.cashierMaxDiscountBp)} discount`;
    case 'assistant':
      return formatSetting('ai.mode', settings.ai.mode);
    default:
      return PAGES.find((p) => p.id === id)!.hint;
  }
}

const LEVEL: Record<SettingsIssue['level'], { icon: LucideIcon; className: string }> = {
  error: { icon: CircleAlert, className: 'text-destructive' },
  warning: { icon: TriangleAlert, className: 'text-amber-600' },
  tip: { icon: Lightbulb, className: 'text-sky-600' },
};

/** The start page of Settings: every section at a glance, what to fix, and the assistant. */
export function Overview({
  settings,
  onGo,
}: {
  settings: AllSettings;
  onGo: (page: PageId) => void;
}) {
  const issues = checkSettings(settings);
  const { data: ai } = useAssistantStatus();
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid gap-6">
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {PAGES.filter((p) => p.id !== 'overview').map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onGo(p.id)}
              className="bg-card hover:border-brand/40 group flex items-center gap-3 rounded-xl border p-3.5 text-left shadow-xs transition-all hover:shadow-md"
            >
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', p.tone)}>
                <p.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {summary(p.id, settings)}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground/60 group-hover:text-brand size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Setup check
              {issues.length > 0 && (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                  {issues.length}
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {issues.length
                ? 'A few things worth a look. Each one opens the right page.'
                : 'Everything important is set up.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {issues.length === 0 ? (
              <p className="text-success flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-5" /> No problems found.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {issues.map((i) => {
                  const L = LEVEL[i.level];
                  return (
                    <li key={i.id} className="flex items-start gap-3 px-3 py-2.5">
                      <L.icon className={cn('mt-0.5 size-4 shrink-0', L.className)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{i.title}</p>
                        <p className="text-muted-foreground text-xs">{i.detail}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onGo(ISSUE_PAGE[i.section])}
                      >
                        Fix
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3 xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AiOrb size={22} glow={false} /> Change settings in words
          </CardTitle>
          <CardDescription>
            You see every change before it is saved.
            {(!ai || ai.mode === 'off' || !ai.ready) && (
              <>
                {' '}
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => onGo('assistant')}
                >
                  Turn on the free AI (Groq)
                </button>{' '}
                to use any words or language.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-[520px] flex-col">
          <SettingsAssistant />
        </CardContent>
      </Card>
    </div>
  );
}
