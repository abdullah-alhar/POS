import { openPanel } from '@/app/keyboard-layer';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AiOrb } from './ai-orb';

/**
 * The animated AI button: floating in the corner of every page, and in the billing screen's top
 * bar (where the corner holds the Pay buttons). Opens Ask (also Ctrl+J).
 */
export function AskAiButton({ floating = false }: { floating?: boolean }) {
  if (!floating) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => openPanel('ask')}
            aria-label="Ask the AI assistant (Ctrl+J)"
            className="shrink-0 rounded-full transition-transform hover:scale-105 active:scale-95"
          >
            <AiOrb size={40} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Ask AI · Ctrl+J</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openPanel('ask')}
      aria-label="Ask the AI assistant (Ctrl+J)"
      className="ask-fab group fixed right-6 bottom-6 z-40 flex items-center gap-2 print:hidden"
    >
      <span
        className={cn(
          'bg-card text-foreground pointer-events-none flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium shadow-lg',
          'translate-x-2 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100',
        )}
      >
        Ask AI
        <kbd className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
          Ctrl J
        </kbd>
      </span>
      <span className="rounded-full shadow-[0_10px_30px_-8px_var(--glow)] transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
        <AiOrb size={54} />
      </span>
    </button>
  );
}
