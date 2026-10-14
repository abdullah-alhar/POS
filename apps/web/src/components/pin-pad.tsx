import { useEffect } from 'react';
import { Delete } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Touch-friendly PIN entry that also listens to the keyboard (digits, Backspace, Enter). */
export function PinPad({
  value,
  onChange,
  onSubmit,
  maxLength = 6,
  disabled,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
  error?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (disabled) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        if (value.length < maxLength) onChange(value + e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        onChange(value.slice(0, -1));
      } else if (e.key === 'Enter' && value.length >= 4) {
        e.preventDefault();
        onSubmit(value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onSubmit, maxLength, disabled]);

  const press = (d: string) => value.length < maxLength && onChange(value + d);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-6 items-center gap-3" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-3.5 rounded-full border-2 transition-colors',
              i < value.length ? 'border-primary bg-primary' : 'border-muted-foreground/40',
              error && 'border-destructive bg-destructive/80',
            )}
          />
        ))}
      </div>
      <p
        className={cn('h-4 text-sm', error ? 'text-destructive' : 'text-transparent')}
        role="alert"
      >
        {error || '.'}
      </p>
      <div className="grid grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <PadButton key={d} onClick={() => press(d)} disabled={disabled}>
            {d}
          </PadButton>
        ))}
        <PadButton onClick={() => onChange('')} disabled={disabled} className="text-sm">
          Clear
        </PadButton>
        <PadButton onClick={() => press('0')} disabled={disabled}>
          0
        </PadButton>
        <PadButton
          onClick={() => onChange(value.slice(0, -1))}
          disabled={disabled}
          aria-label="Delete"
        >
          <Delete className="size-5" />
        </PadButton>
      </div>
      <Button
        size="lg"
        className="w-full"
        disabled={disabled || value.length < 4}
        onClick={() => onSubmit(value)}
      >
        OK
      </Button>
    </div>
  );
}

function PadButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn('h-14 w-20 text-xl font-medium', className)}
      tabIndex={-1}
      {...props}
    />
  );
}
