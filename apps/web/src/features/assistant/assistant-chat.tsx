import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Check,
  Cpu,
  Loader2,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import type { AssistantStatus } from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface AssistantTurn {
  reply: string;
  done?: string[];
  problems?: string[];
  source?: 'built-in' | 'ai';
  /** Extra content under the answer (e.g. a list of changes to approve). */
  extra?: ReactNode;
  /** Undo what this answer did. */
  undo?: () => void;
}

interface Message {
  id: number;
  from: 'user' | 'assistant';
  text: string;
  turn?: AssistantTurn;
  error?: boolean;
}

export const useAssistantStatus = () =>
  useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => api.get<AssistantStatus>('/assistant/status'),
    staleTime: 60_000,
    retry: false,
  });

/**
 * A chat with the assistant. Requests in plain words; common ones are answered at once by the
 * built-in assistant, others by the free local AI model when it is turned on.
 */
export function AssistantChat({
  intro,
  examples,
  send,
  placeholder = 'Type what you want…',
  inputRef,
}: {
  intro: string;
  examples: string[];
  send: (message: string) => Promise<AssistantTurn>;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const { data: status } = useAssistantStatus();

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy]);

  async function ask(message: string) {
    const m = message.trim();
    if (!m || busy) return;
    setText('');
    setMessages((all) => [...all, { id: nextId.current++, from: 'user', text: m }]);
    setBusy(true);
    try {
      const turn = await send(m);
      setMessages((all) => [
        ...all,
        { id: nextId.current++, from: 'assistant', text: turn.reply, turn },
      ]);
    } catch (err) {
      setMessages((all) => [
        ...all,
        {
          id: nextId.current++,
          from: 'assistant',
          text: err instanceof ApiError ? err.message : 'Something went wrong. Try again.',
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
        <Sparkles className="text-brand size-3.5" />
        Built-in assistant
        {status?.enabled && (
          <span
            className={cn(
              'ml-auto flex items-center gap-1 rounded-full px-1.5 py-0.5',
              status.modelReady ? 'bg-success/15 text-success' : 'bg-warning/20 text-amber-700',
            )}
            title={status.problem ?? `Free local AI model ${status.model} is ready`}
          >
            <Cpu className="size-3" /> {status.modelReady ? status.model : 'AI not ready'}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="bg-accent/50 rounded-lg p-3 text-xs leading-relaxed">
            <p className="flex items-center gap-1.5 font-medium">
              <Bot className="size-4" /> {intro}
            </p>
            <p className="text-muted-foreground mt-2">Try one:</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => ask(ex)}
                  className="bg-background hover:border-brand/50 rounded-full border px-2 py-0.5 text-[11px]"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.from === 'user' ? (
            <p
              key={m.id}
              className="bg-brand text-brand-foreground ml-6 rounded-lg rounded-br-sm px-3 py-1.5 text-sm"
            >
              {m.text}
            </p>
          ) : (
            <div
              key={m.id}
              className={cn(
                'mr-4 rounded-lg rounded-bl-sm border px-3 py-2 text-sm',
                m.error ? 'border-destructive/40 bg-destructive/5' : 'bg-card',
              )}
            >
              {m.text && <p className="whitespace-pre-line">{m.text}</p>}
              {m.turn?.done?.map((d) => (
                <p key={d} className="mt-1 flex gap-1.5 text-xs">
                  <Check className="text-success mt-0.5 size-3.5 shrink-0" /> {d}
                </p>
              ))}
              {m.turn?.problems?.map((p) => (
                <p key={p} className="text-muted-foreground mt-1 flex gap-1.5 text-xs">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" /> {p}
                </p>
              ))}
              {m.turn?.extra}
              {(m.turn?.undo || m.turn?.source) && (
                <div className="mt-1.5 flex items-center gap-2">
                  {m.turn.undo && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-xs"
                      onClick={m.turn.undo}
                    >
                      <Undo2 className="size-3" /> Undo
                    </Button>
                  )}
                  {m.turn.source && (
                    <span className="text-muted-foreground ml-auto text-[10px]">
                      {m.turn.source === 'ai' ? 'Local AI model' : 'Built-in'}
                    </span>
                  )}
                </div>
              )}
            </div>
          ),
        )}
        {busy && (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" /> Working on it…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="bg-card focus-within:border-ring flex items-end gap-1 rounded-lg border p-1"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <textarea
          ref={inputRef}
          value={text}
          rows={2}
          maxLength={500}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(text);
            }
          }}
          className="min-h-9 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none"
        />
        <Button type="submit" size="icon-sm" disabled={!text.trim() || busy} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
