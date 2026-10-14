import { useState } from 'react';
import { centsToInput, parseMoney } from '@marina/shared';
import { Input } from '@/components/ui/input';
import { usePublicSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * Text box for money. Shows rupees, gives the form whole cents. Invalid text gives NaN, which
 * the Zod schema rejects with a clear message.
 */
export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: number | undefined;
  onChange: (cents: number) => void;
}) {
  const { data } = usePublicSettings();
  const symbol = data?.pos.currencySymbol ?? 'Rs';
  const [text, setText] = useState(() => (Number.isFinite(value) ? centsToInput(value!) : ''));

  // Follow outside changes (e.g. a form reset) without fighting the user's typing.
  const [prevValue, setPrevValue] = useState(value);
  if (!Object.is(value, prevValue)) {
    setPrevValue(value);
    if (value !== undefined && Number.isFinite(value) && parseMoney(text) !== value) {
      setText(centsToInput(value));
    }
  }

  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs">
        {symbol}
      </span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const cents = parseMoney(e.target.value);
          onChange(cents === null || cents < 0 ? Number.NaN : cents);
        }}
        onFocus={(e) => e.target.select()}
        className={cn('pl-9 text-right tabular-nums', className)}
        {...props}
      />
    </div>
  );
}
