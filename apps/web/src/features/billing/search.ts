import type { PosIndexItem } from '@marina/shared';

/**
 * Local search over the in-memory catalogue: every word must appear in the name, SKU, brand or
 * category. Items whose name starts with the first word come first.
 */
export function searchItems(
  items: readonly PosIndexItem[],
  query: string,
  limit = 8,
): PosIndexItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { item: PosIndexItem; score: number }[] = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    const hay = `${name} ${item.sku.toLowerCase()} ${(item.brand ?? '').toLowerCase()} ${(item.category ?? '').toLowerCase()} ${item.barcodes.join(' ')}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    if (name.startsWith(words[0]!)) score += 2;
    if (item.sku.toLowerCase() === words[0]) score += 3;
    if (item.stockQty <= 0 && item.trackStock) score -= 1;
    scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((s) => s.item);
}

/** "3*2000000000015" → qty 3 and the code. */
export function parseQtyPrefix(text: string): { qty: number; code: string } {
  const m = /^(\d{1,4})\s*[*xX]\s*(.+)$/.exec(text.trim());
  if (m) return { qty: Math.max(1, Number(m[1])), code: m[2]!.trim() };
  return { qty: 1, code: text.trim() };
}
