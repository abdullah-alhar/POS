import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { normalizeBarcode, type PosIndex, type PosIndexItem } from '@marina/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queries';

export interface PosCatalog {
  items: PosIndexItem[];
  /** Barcode or SKU → item. A Map lookup takes microseconds. */
  byCode: Map<string, PosIndexItem>;
  find: (code: string) => PosIndexItem | undefined;
}

/** Every sellable item, kept in memory for instant scanning. Refreshed every minute. */
export function usePosIndex() {
  const query = useQuery({
    queryKey: keys.posIndex,
    queryFn: () => api.get<PosIndex>('/catalog/pos-index'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const catalog = useMemo<PosCatalog | null>(() => {
    if (!query.data) return null;
    const byCode = new Map<string, PosIndexItem>();
    for (const item of query.data.items) {
      byCode.set(item.sku.toUpperCase(), item);
      for (const code of item.barcodes) byCode.set(code, item);
    }
    return {
      items: query.data.items,
      byCode,
      find: (code) => {
        const clean = normalizeBarcode(code);
        return byCode.get(clean) ?? byCode.get(clean.toUpperCase());
      },
    };
  }, [query.data]);

  return { ...query, catalog };
}
