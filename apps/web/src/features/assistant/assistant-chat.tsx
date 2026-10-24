import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  Check,
  Copy,
  Languages,
  Loader2,
  Mic,
  Square,
  TriangleAlert,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AssistantStatus } from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AiOrb } from './ai-orb';
import { plainText, RichText } from './rich-text';
import { speak, useVoice, VOICE_LANGUAGES } from './use-voice';

export interface AssistantTurn {
  reply: string;
  done?: string[];
  problems?: string[];
  source?: 'built-in' | 'ai';
  /** Extra content under the answer (e.g. a list of changes to approve). */
  extra?: ReactNode;
  /** Undo what this answer did. */
  undo?: () => void;
  /** Something to know, e.g. why the online AI could not help this time. */
  notice?: string;
  /** Follow-up questions to try. */
  suggestions?: string[];
}

interface Message {
  id: number;
  from: 'user' | 'assistant';
  text: string;
  turn?: AssistantTurn;
  error?: boolean;
  voice?: boolean;
}

/** Which AI is on (for people who manage settings; others just use the assistant). */
export const useAssistantStatus = (enabled = true) =>
  useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => api.get<AssistantStatus>('/assistant/status'),
    staleTime: 60_000,
    retry: false,
    enabled,
    meta: { silent: true },
  });

const chip =
  'bg-background hover:border-brand/50 hover:bg-accent/60 rounded-full border px-3 py-1 text-xs transition-colors';

/**
 * A chat with the assistant, in any language, typed or spoken. Common requests are answered at
 * once by the built-in assistant (also offline), others by the AI chosen in Settings → Assistant.
 */
export function AssistantChat({
  intro,
  examples,
  send,
  placeholder = 'Type what you want…',
  inputRef,
  showStatus = true,
  initialMessage,
  hero,
}: {
  intro: string;
  examples: string[];
  /** Answer a message; `history` holds the earlier questions of this chat. */
  send: (message: string, history: string[]) => Promise<AssistantTurn>;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Show which AI is on (needs the settings permission). */
  showStatus?: boolean;
  /** Ask this at once (e.g. typed in Ctrl+K). */
  initialMessage?: string;
  /** A large welcome (the Ask panel) instead of the compact one; `ask` sends a question. */
  hero?: (ask: (question: string) => void) => ReactNode;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const { data: status } = useAssistantStatus(showStatus);
  const voice = useVoice((spoken) => void ask(spoken, true));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, busy]);

  // Grow the box with the text (up to a few lines).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const asked = useRef(false);
  useEffect(() => {
    if (initialMessage && !asked.current) {
      asked.current = true;
      void ask(initialMessage);
    }
    // Only once, when the chat opens with a question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ask(message: string, spoken = false) {
    const m = message.trim();
    if (!m || busy) return;
    const history = messages
      .filter((x) => x.from === 'user')
      .map((x) => x.text.slice(0, 500))
      .slice(-6);
    setText('');
    setMessages((all) => [...all, { id: nextId.current++, from: 'user', text: m, voice: spoken }]);
    setBusy(true);
    try {
      const turn = await send(m, history);
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
      boxRef.current?.focus();
    }
  }

  function readAloud(m: Message) {
    if (speaking === m.id) {
      window.speechSynthesis?.cancel();
      setSpeaking(null);
      return;
    }
    setSpeaking(m.id);
    speak(plainText(m.text), () => setSpeaking((s) => (s === m.id ? null : s)));
  }

  const lastAssistant = [...messages].reverse().find((m) => m.from === 'assistant')?.id;
  const recording = voice.state === 'recording';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {showStatus && status && status.mode !== 'off' && !status.ready && (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5 shrink-0" />
          {status.problem ?? 'The AI is not ready.'} The built-in assistant still answers.
        </p>
      )}

      <div className="-mr-2 min-h-0 flex-1 space-y-5 overflow-y-auto pr-2">
        {messages.length === 0 &&
          (hero?.((q) => void ask(q)) ?? (
            <div className="bg-accent/40 rounded-xl p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AiOrb size={22} glow={false} /> {intro}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {examples.map((ex) => (
                  <button key={ex} type="button" onClick={() => ask(ex)} className={chip}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ))}

        {messages.map((m) =>
          m.from === 'user' ? (
            <div key={m.id} className="ai-rise flex justify-end">
              <p className="bg-brand text-brand-foreground max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                {m.voice && <Mic className="mr-1 inline size-3.5 opacity-80" />}
                {m.text}
              </p>
            </div>
          ) : (
            <div key={m.id} className="ai-rise flex gap-2.5">
              <AiOrb size={26} glow={false} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                {m.error ? (
                  <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm">
                    {m.text}
                  </p>
                ) : (
                  m.text && <RichText text={m.text} className="text-sm leading-relaxed" />
                )}
                {m.turn?.done && m.turn.done.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {m.turn.done.map((d) => (
                      <li key={d} className="flex gap-1.5 text-xs">
                        <Check className="text-success mt-0.5 size-3.5 shrink-0" /> {d}
                      </li>
                    ))}
                  </ul>
                )}
                {m.turn?.problems && m.turn.problems.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {m.turn.problems.map((p) => (
                      <li key={p} className="text-muted-foreground flex gap-1.5 text-xs">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" /> {p}
                      </li>
                    ))}
                  </ul>
                )}
                {m.turn?.extra}
                {m.turn?.notice && (
                  <p className="mt-2 flex gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="mt-px size-3 shrink-0" /> {m.turn.notice}
                  </p>
                )}
                {m.id === lastAssistant && m.turn?.suggestions && m.turn.suggestions.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {m.turn.suggestions.map((sug) => (
                      <button key={sug} type="button" onClick={() => ask(sug)} className={chip}>
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
                {!m.error && (
                  <div className="text-muted-foreground mt-1.5 flex items-center gap-0.5">
                    {m.turn?.undo && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={m.turn.undo}
                      >
                        <Undo2 className="size-3.5" /> Undo
                      </Button>
                    )}
                    {m.text && (
                      <>
                        <IconAction
                          label="Copy"
                          onClick={() => {
                            void navigator.clipboard?.writeText(plainText(m.text));
                            toast.success('Copied');
                          }}
                        >
                          <Copy />
                        </IconAction>
                        <IconAction
                          label={speaking === m.id ? 'Stop reading' : 'Read aloud'}
                          onClick={() => readAloud(m)}
                        >
                          {speaking === m.id ? <VolumeX /> : <Volume2 />}
                        </IconAction>
                      </>
                    )}
                    {m.turn?.source && (
                      <span className="ml-auto text-[10px]">
                        {m.turn.source === 'ai' ? 'AI' : 'Built-in · offline'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-center gap-2.5">
            <AiOrb size={26} state="thinking" glow={false} />
            <span className="ai-dots text-brand flex gap-1 text-lg leading-none">
              <span>•</span>
              <span>•</span>
              <span>•</span>
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className={cn(
          'bg-card rounded-2xl border shadow-sm transition-shadow',
          'focus-within:border-brand/50 focus-within:shadow-[0_0_0_3px_var(--glow)]',
          recording && 'border-destructive/50',
        )}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        {recording || voice.state === 'working' ? (
          <div className="flex h-[52px] items-center gap-3 px-4">
            {recording ? (
              <>
                <span className="relative flex size-2.5">
                  <span className="bg-destructive absolute inset-0 animate-ping rounded-full opacity-60" />
                  <span className="bg-destructive relative size-2.5 rounded-full" />
                </span>
                <span className="text-sm font-medium">Listening…</span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" /> Reading your voice message…
              </span>
            )}
          </div>
        ) : (
          <textarea
            ref={(el) => {
              boxRef.current = el;
              if (inputRef) inputRef.current = el;
            }}
            value={text}
            rows={1}
            maxLength={1000}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(text);
              }
            }}
            className="placeholder:text-muted-foreground/80 block max-h-40 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm outline-none"
          />
        )}
        <div className="flex items-center gap-1 px-2 pb-2">
          <span className="text-muted-foreground flex items-center gap-1 px-2 text-[11px]">
            <Languages className="size-3.5" /> Any language
          </span>
          {voice.mode === 'browser' && !recording && (
            <select
              value={voice.language}
              onChange={(e) => voice.setLanguage(e.target.value)}
              aria-label="Voice language"
              className="text-muted-foreground hover:text-foreground rounded-md bg-transparent px-1 text-[11px] outline-none"
            >
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-1">
            {recording ? (
              <>
                <IconAction label="Cancel" onClick={() => voice.stop(false)}>
                  <X />
                </IconAction>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="destructive"
                  className="rounded-full"
                  aria-label="Send voice message"
                  onClick={() => voice.stop(true)}
                >
                  <Square className="fill-current" />
                </Button>
              </>
            ) : (
              <>
                <IconAction
                  label={
                    voice.mode
                      ? 'Speak (any language)'
                      : 'Voice needs the free Groq key, or Chrome / Edge'
                  }
                  onClick={() => void voice.start()}
                  disabled={busy || voice.state !== 'idle'}
                >
                  <Mic />
                </IconAction>
                <Button
                  type="submit"
                  size="icon-sm"
                  className="rounded-full"
                  disabled={!text.trim() || busy}
                  aria-label="Send"
                >
                  <ArrowUp />
                </Button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground size-7 rounded-full [&_svg]:size-3.5"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
