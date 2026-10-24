import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
  HandCoins,
  Lightbulb,
  PackageSearch,
  SquarePen,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import {
  applySettingChanges,
  ASK_EXAMPLES,
  type AllSettings,
  type AskAnswer,
  type AskCard,
} from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { keys } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Proposal } from '../settings/settings-assistant';
import { AiOrb } from './ai-orb';
import { AssistantChat, type AssistantTurn } from './assistant-chat';
import { useAbilities } from './use-voice';

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

/** Icons for the starter questions. */
const STARTERS: {
  q: string;
  icon: LucideIcon;
  permission?: Parameters<ReturnType<typeof useCan>>[0];
}[] = [
  { q: 'How are sales today?', icon: BarChart3, permission: 'reports.view' },
  { q: 'What is running low?', icon: Boxes, permission: 'products.view' },
  { q: 'Who owes us money?', icon: HandCoins, permission: 'customers.manage' },
  { q: 'How much cash is in the drawer?', icon: Wallet, permission: 'cash.register' },
  { q: 'Price of USB cable', icon: PackageSearch, permission: 'products.view' },
  { q: 'Give me 3 ideas to sell more this week', icon: Lightbulb, permission: 'reports.view' },
];

function examplesFor(path: string) {
  const own = PAGE_EXAMPLES.find(([re]) => re.test(path))?.[1] ?? [];
  return [...new Set([...own, ...ASK_EXAMPLES])].slice(0, 8);
}

/** Numbers and a table behind an answer. */
function Card({ card }: { card: AskCard }) {
  return (
    <div className="grid gap-2">
      {card.title && (
        <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {card.title}
        </p>
      )}
      {card.facts && (
        <div className="grid grid-cols-2 gap-2">
          {card.facts.map((f) => (
            <div key={f.label} className="bg-card rounded-xl border px-3 py-2 shadow-xs">
              <p className="text-muted-foreground text-[11px]">{f.label}</p>
              <p className="text-base font-semibold tabular-nums">{f.value}</p>
              {f.hint && <p className="text-muted-foreground text-[10px]">{f.hint}</p>}
            </div>
          ))}
        </div>
      )}
      {card.table && (
        <div className="bg-card max-h-64 overflow-auto rounded-xl border shadow-xs">
          <table className="w-full text-xs">
            <thead className="bg-muted/80 text-muted-foreground sticky top-0 backdrop-blur">
              <tr>
                {card.table.columns.map((c, i) => (
                  <th
                    key={`${c}-${i}`}
                    className={cn(
                      'px-2.5 py-1.5 font-medium',
                      card.table!.align?.[i] === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {card.table.rows.map((row, r) => (
                <tr key={r} className="hover:bg-muted/40">
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={cn(
                        'px-2.5 py-1.5',
                        card.table!.align?.[i] === 'right' && 'text-right tabular-nums',
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
    </div>
  );
}

function AnswerExtra({ answer, onGo }: { answer: AskAnswer; onGo: (to: string) => void }) {
  if (!answer.cards?.length && !answer.links?.length) return null;
  return (
    <div className="mt-3 grid gap-3">
      {answer.cards?.map((c, i) => (
        <Card key={i} card={c} />
      ))}
      {answer.links && (
        <div className="flex flex-wrap gap-1.5">
          {answer.links.map((l) => (
            <Button
              key={l.to}
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => onGo(l.to)}
            >
              {l.label} <ArrowUpRight className="size-3.5" />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Ask": the assistant on every page (the AI button, the sidebar, Ctrl+J, or a question in
 * Ctrl+K). A chat in any language, typed or spoken: sales, stock, customers, how-to, opening
 * pages and setting changes. Works without internet for the usual questions.
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
  const { data: me } = useMe();
  const { data: abilities } = useAbilities();
  const queryClient = useQueryClient();
  const [chat, setChat] = useState(0);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  async function send(message: string, history: string[]): Promise<AssistantTurn> {
    const answer = await api.post<AskAnswer>('/assistant/ask', { message, history });
    if (answer.navigate) setTimeout(() => go(answer.navigate!), 700);
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

  const firstName = me?.fullName?.split(/\s+/)[0];
  const starters = STARTERS.filter((s) => !s.permission || can(s.permission)).slice(0, 4);
  const hero = (ask: (q: string) => void) => (
    <div className="flex flex-col items-center px-2 pt-6 text-center">
      <AiOrb size={64} />
      <h2 className="mt-5 text-xl font-semibold tracking-tight">
        {firstName ? `Hi ${firstName}, how can I help?` : 'How can I help?'}
      </h2>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-sm">
        Ask about sales, stock, customers or how to do something. Type or speak, in English, සිංහල,
        தமிழ் or any language.
      </p>
      <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
        {starters.map((s) => (
          <button
            key={s.q}
            type="button"
            onClick={() => ask(s.q)}
            className="bg-card hover:border-brand/40 hover:bg-accent/40 group flex items-start gap-2.5 rounded-xl border p-3 text-left text-sm shadow-xs transition-colors"
          >
            <s.icon className="text-brand mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{s.q}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton
        className="top-0 right-0 left-auto flex h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-[560px]"
      >
        <header className="flex items-center gap-3 border-b px-5 py-3.5 pr-14">
          <AiOrb size={34} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">Assistant</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  abilities?.ai ? 'bg-success' : 'bg-muted-foreground/50',
                )}
              />
              {abilities?.ai
                ? 'AI on · understands any question'
                : 'Built-in assistant · works offline'}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setChat((c) => c + 1)}
          >
            <SquarePen /> New chat
          </Button>
        </header>
        {open && (
          <div className="flex min-h-0 flex-1 flex-col px-5 pt-4 pb-5">
            <AssistantChat
              key={`${chat}-${question ?? ''}`}
              intro="What would you like to know?"
              examples={examplesFor(pathname)}
              send={send}
              placeholder="Ask anything… e.g. compare this month with last month"
              showStatus={can('settings.manage')}
              initialMessage={chat ? undefined : question}
              hero={hero}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
