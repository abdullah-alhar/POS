import { useState } from 'react';
import { bpToPercentText, parsePercent, type Discount } from '@shoppos/shared';
import { MoneyInput } from '@/components/money-input';
import { Input } from '@/components/ui/input';
import { usePublicSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Discount as an amount (Rs) or a percentage. Empty or zero means no discount. */
export function DiscountEditor({
  value,
  onChange,
  autoFocus,
}: {
  value: Discount | null;
  onChange: (value: Discount | null) => void;
  autoFocus?: boolean;
}) {
  const { data } = usePublicSettings();
  const symbol = data?.pos.currencySymbol ?? 'Rs';
  const [type, setType] = useState<Discount['type']>(value?.type ?? 'PERCENT');
  const [percent, setPercent] = useState(
    value?.type === 'PERCENT' ? bpToPercentText(value.value) : '',
  );

  function switchTo(next: Discount['type']) {
    setType(next);
    setPercent('');
    onChange(null);
  }

  return (
    <div className="flex gap-2">
      <div className="bg-muted inline-flex shrink-0 rounded-md p-1">
        {(['PERCENT', 'AMOUNT'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTo(t)}
            className={cn(
              'h-8 min-w-12 rounded px-3 text-sm font-medium',
              type === t ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t === 'PERCENT' ? '%' : symbol}
          </button>
        ))}
      </div>
      {type === 'PERCENT' ? (
        <div className="relative flex-1">
          <Input
            autoFocus={autoFocus}
            inputMode="decimal"
            value={percent}
            placeholder="0"
            className="pr-8 text-right"
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setPercent(e.target.value);
              const bp = parsePercent(e.target.value);
              onChange(bp && bp > 0 ? { type: 'PERCENT', value: Math.min(bp, 10_000) } : null);
            }}
          />
          <span className="text-muted-foreground absolute inset-y-0 right-3 flex items-center text-sm">
            %
          </span>
        </div>
      ) : (
        <MoneyInput
          autoFocus={autoFocus}
          className="flex-1"
          value={value?.type === 'AMOUNT' ? value.value : undefined}
          onChange={(cents) =>
            onChange(Number.isFinite(cents) && cents > 0 ? { type: 'AMOUNT', value: cents } : null)
          }
        />
      )}
    </div>
  );
}
