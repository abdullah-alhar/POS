import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { PosIndexItem } from '@shoppos/shared';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { searchItems } from '@/features/billing/search';
import { usePosIndex } from '@/features/billing/use-pos-index';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * Find an item by name, SKU or barcode (scanning works too) from the in-memory catalogue.
 * Used by stock adjustments, purchases and label printing.
 */
export function ItemSearch({
  onPick,
  placeholder = 'Search or scan an item to add',
  showPrice = 'retail',
  autoFocus,
}: {
  onPick: (item: PosIndexItem) => void;
  placeholder?: string;
  showPrice?: 'retail' | 'none';
  autoFocus?: boolean;
}) {
  const { catalog } = usePosIndex();
  const money = useMoney();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => (catalog && text.trim().length >= 2 ? searchItems(catalog.items, text, 8) : []),
    [catalog, text],
  );

  function pick(item: PosIndexItem) {
    onPick(item);
    setText('');
    setActive(0);
    inputRef.current?.focus();
  }

  return (
    <div className="relative">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        value={text}
        disabled={!catalog}
        placeholder={catalog ? placeholder : 'Loading items…'}
        className="pl-9"
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const exact = catalog?.find(text);
            const item = exact ?? (/^[\d\s-]+$/.test(text.trim()) ? undefined : results[active]);
            if (item) pick(item);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (results.length)
              setActive(
                (a) => (a + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length,
              );
          } else if (e.key === 'Escape') setText('');
        }}
      />
      {results.length > 0 && (
        <ul className="bg-popover absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border shadow-lg">
          {results.map((item, i) => (
            <li key={item.variantId}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(item)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                  i === active && 'bg-accent',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.name}</span>
                  <span className="text-muted-foreground text-xs">{item.sku}</span>
                </span>
                {item.trackStock && <Badge variant="secondary">{item.stockQty} in stock</Badge>}
                {showPrice === 'retail' && (
                  <span className="tabular-nums">{money(item.retailPrice)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
