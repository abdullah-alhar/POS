import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The assistant's animated icon. Thinking spins faster; listening glows red. */
export function AiOrb({
  size = 28,
  state = 'idle',
  glow = true,
  className,
}: {
  size?: number;
  state?: 'idle' | 'thinking' | 'listening';
  glow?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn('ai-orb', className)}
      data-state={state}
      data-glow={glow ? 'on' : 'off'}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="ai-orb-core" />
      <Sparkles style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.2} />
    </span>
  );
}
