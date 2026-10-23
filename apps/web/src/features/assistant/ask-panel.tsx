import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import {
  applySettingChanges,
  ASK_EXAMPLES,
  type AllSettings,
  type AskAnswer,
} from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Proposal } from '../settings/settings-assistant';
import { AssistantChat, type AssistantTurn } from './assistant-chat';

/** Questions that fit the page you are on, first. */
const PAGE_EXAMPLES: [RegExp, string[]][] = [
  [
    /^\/reports|^\/dashboard/,
    ['Compare this month with last month', 'Best sellers this week', 'What is not selling?'],
  ],
  [
    /^\/products|^\/stock|^\/purchases/,
    ['What is running low?', 'Price of USB cable', 'What is not selling?'],
  ],
  [/^\/customers/, ['Who owes us money?', 'How do I take a customer payment?']],
  [
    /^\/cash|^\/expenses/,
    ['How much cash is in the drawer?', 'Expenses this month', 'How do I close the day?'],
  ],
  [/^\/billing/, ['Price of USB cable', 'How do I give a discount?', 'How do I hold a bill?']],
  [
    /^\/settings/,
    [
      'Round bill totals to the nearest Rs 10',
      'Open the receipt design',
      'How do I turn on a free AI?',
    ],
  ],
];

function examplesFor(path: string) {
  const own = PAGE_EXAMPLES.find(([re]) => re.test(path))?.[1] ?? [];
  return [...new Set([...own, ...ASK_EXAMPLES])].slice(0, 8);
}

/** The numbers, table and buttons of an answer. */
function AnswerExtra({ answer, onGo }: { answer: AskAnswer; onGo: (to: string) => void }) {
  return (
    <div className="mt-2 grid gap-2">
      {answer.facts && (
        <div className="grid grid-cols-2 gap-1.5">
          {answer.facts.map((f) => (
            <div key={f.label} className="bg-muted/70 rounded-md px-2 py-1.5">
              <p className="text-muted-foreground text-[10px] uppercase">{f.label}</p>
              <p className="font-semibold tabular-nums">{f.value}</p>
              {f.hint && <p className="text-muted-foreground text-[10px]">{f.hint}</p>}
            </div>
          ))}
        </div>
      )}
      {answer.table && (
        <div className="max-h-64 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/70 text-muted-foreground sticky top-0">
              <tr>
                {answer.table.columns.map((c, i) => (
                  <th
                    key={`${c}-${i}`}
                    className={cn(
                      'px-2 py-1 font-medium',
                      answer.table!.align?.[i] === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {answer.table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={cn(
                        'px-2 py-1',
                        answer.table!.align?.[i] === 'right' && 'text-right tabular-nums',
                        i === 0 && 'font-medium',
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {answer.links && (
        <div className="flex flex-wrap gap-1.5">
          {answer.links.map((l) => (
            <Button
              key={l.to}
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => onGo(l.to)}
            >
              {l.label} <ArrowRight />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Ask": the assistant on every page (sidebar button, Ctrl+J, or type a question in Ctrl+K).
 * Answers sales, stock, customer and how-to questions from the shop's own data, opens pages and
 * suggests setting changes, also without internet.
 */
export function AskPanel({
  open,
  onClose,
  question,
}: {
  open: boolean;
  onClose: () => void;
  /** A question to ask at once. */
  question?: string;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const can = useCan();
  const queryClient = useQueryClient();

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  async function send(message: string): Promise<AssistantTurn> {
    const answer = await api.post<AskAnswer>('/assistant/ask', { message });
    if (answer.navigate) setTimeout(() => go(answer.navigate!), 600);
    let extra = <AnswerExtra answer={answer} onGo={go} />;
    if (answer.settings?.length) {
      const now =
        queryClient.getQueryData<AllSettings>(keys.settings) ??
        (await api.get<AllSettings>('/settings'));
      queryClient.setQueryData(keys.settings, now);
      const result = applySettingChanges(now, answer.settings);
      extra = (
        <>
          {extra}
          {result.sections.length > 0 && <Proposal next={result.next} sections={result.sections} />}
        </>
      );
    }
    return {
      reply: answer.reply,
      source: answer.source,
      extra,
      notice: answer.aiProblem,
      suggestions: answer.suggestions,
    };
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-0 right-0 left-auto flex h-full max-h-full w-full max-w-md translate-x-0 translate-y-0 flex-col gap-3 rounded-none border-y-0 border-r-0 p-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-brand size-5" /> Ask
          </DialogTitle>
          <DialogDescription>
            Ask about sales, stock, customers or how to do something. Works without internet.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AssistantChat
            key={question ?? 'ask'}
            intro="What would you like to know?"
            examples={examplesFor(pathname)}
            send={send}
            placeholder="e.g. compare this month with last month"
            showStatus={can('settings.manage')}
            initialMessage={question}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
