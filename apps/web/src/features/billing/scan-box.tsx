import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import type { PosIndexItem, PriceMode } from '@marina/shared';
import { Badge } from '@/components/ui/badge';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { parseQtyPrefix, searchItems } from './search';
import type { PosCatalog } from './use-pos-index';

export interface ScanBoxHandle {
  focus: () => void;
  isEmpty: () => boolean;
}

/**
 * One box for everything: a scanner types the barcode and presses Enter (instant lookup in memory);
 * typing words shows matching items (↑ ↓ to choose, Enter to add). "3*code" adds three.
 */
export const ScanBox = forwardRef<
  ScanBoxHandle,
  {
    catalog: PosCatalog | null;
    priceMode: PriceMode;
    onAdd: (item: PosIndexItem, qty: number) => void;
    onNotFound: (code: string) => void;
    /** "5*" then Enter (nothing after the star): set the selected line's quantity to 5. */
    onSetQty: (qty: number) => void;
    /** Keys the box does not use (arrows, +, − on an empty box) go to the cart. */
    onEmptyKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  }
>(function ScanBox({ catalog, priceMode, onAdd, onNotFound, onSetQty, onEmptyKey }, ref) {
  const money = useMoney();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    isEmpty: () => !inputRef.current?.value,
  }));

  const { qty, code } = parseQtyPrefix(text);
  const suggestions = useMemo(
    () =>
      catalog && code.length >= 2 && !/^\d{6,}$/.test(code) ? searchItems(catalog.items, code) : [],
    [catalog, code],
  );

  function submit() {
    const qtyOnly = /^(\d{1,4})\s*[*xX]$/.exec(text.trim());
    if (qtyOnly) {
      onSetQty(Math.max(1, Number(qtyOnly[1])));
      setText('');
      return;
    }
    if (!catalog || !code) return;
    const exact = catalog.find(code);
    // A number that is not an exact barcode/SKU is never guessed: the wrong item could be billed.
    const looksLikeCode = /^[\d\s-]+$/.test(code);
    const item = exact ?? (looksLikeCode ? undefined : suggestions[active]);
    if (item) onAdd(item, qty);
    else onNotFound(code);
    setText('');
    setActive(0);
  }

  return (
    <div className="relative flex-1">
      <ScanBarcode className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2" />
      <input
        ref={inputRef}
        autoFocus
        value={text}
        disabled={!catalog}
        placeholder={catalog ? 'Scan a barcode or type to search' : 'Loading items…'}
        aria-label="Scan or search"
        autoComplete="off"
        spellCheck={false}
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-12 w-full rounded-lg border pr-20 pl-11 text-lg shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-60"
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            setText('');
          } else if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setActive(
              (a) =>
                (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length,
            );
          } else if (!text) {
            onEmptyKey(e);
          }
        }}
      />
      <kbd className="text-muted-foreground bg-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px]">
        F2
      </kbd>

      {suggestions.length > 0 && (
        <ul className="bg-popover absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border shadow-lg">
          {suggestions.map((item, i) => {
            const out = item.trackStock && item.stockQty <= 0;
            return (
              <li key={item.variantId}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    onAdd(item, qty);
                    setText('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left',
                    i === active && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {item.sku}
                      {item.brand && ` · ${item.brand}`}
                    </span>
                  </span>
                  {item.trackStock && (
                    <Badge variant={out ? 'destructive' : 'secondary'} className="tabular-nums">
                      {out ? 'No stock' : `${item.stockQty} in stock`}
                    </Badge>
                  )}
                  <span className="w-24 text-right font-semibold tabular-nums">
                    {money(priceMode === 'WHOLESALE' ? item.wholesalePrice : item.retailPrice)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
