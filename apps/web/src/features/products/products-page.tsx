import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Package, Plus, Search, Upload } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Page, ProductListItem } from '@marina/shared';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys, useBrands, useCategories, useMoney } from '@/lib/queries';
import { ImportDialog } from './import-dialog';

const PAGE_SIZE = 50;
const ALL = '__all';

export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const can = useCan();
  const money = useMoney();
  const [importing, setImporting] = useState(false);
  const { data: categories = [] } = useCategories();
  const { data: brands = [] } = useBrands();

  const q = params.get('q') ?? '';
  const categoryId = params.get('category') ?? '';
  const brandId = params.get('brand') ?? '';
  const status = params.get('status') ?? 'active';
  const lowStock = params.get('low') === '1';
  const page = Number(params.get('page') ?? '1');

  // Typing (or scanning) into the search box waits a moment before searching.
  const [search, setSearch] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) update({ q: search, page: '' });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  }

  const query = {
    q,
    categoryId,
    brandId,
    status,
    lowStock: lowStock || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isPending, isFetching } = useQuery({
    queryKey: [...keys.products, query],
    queryFn: () => api.get<Page<ProductListItem>>(`/products${qs(query)}`),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything the shop sells, with prices and stock."
        actions={
          can('products.manage') && (
            <>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload /> Import
              </Button>
              <Button asChild>
                <Link to="/products/new">
                  <Plus /> New product
                </Link>
              </Button>
            </>
          )
        }
      />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="relative min-w-60 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, brand, SKU or scan a barcode"
              className="pl-9"
            />
          </div>
          <Select
            value={categoryId || ALL}
            onValueChange={(v) => update({ category: v === ALL ? '' : v, page: '' })}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={brandId || ALL}
            onValueChange={(v) => update({ brand: v === ALL ? '' : v, page: '' })}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Brand" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All brands</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => update({ status: v === 'active' ? '' : v, page: '' })}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Hidden</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch
              id="low"
              checked={lowStock}
              onCheckedChange={(v) => update({ low: v ? '1' : '', page: '' })}
            />
            <Label htmlFor="low">Low stock</Label>
          </div>
        </div>

        {!isPending && total === 0 ? (
          <EmptyState
            icon={Package}
            title={q || categoryId || brandId || lowStock ? 'No products match' : 'No products yet'}
            description={q ? `Nothing found for "${q}".` : undefined}
          />
        ) : (
          <Table className={isFetching ? 'opacity-70' : undefined}>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU / Barcode</TableHead>
                <TableHead className="text-right">Variants</TableHead>
                <TableHead className="text-right">Retail price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/products/${p.id}`)}
                >
                  <TableCell className="max-w-96">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {[p.brand, p.category].filter(Boolean).join(' · ') || 'No category'}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="font-mono text-xs">{p.firstSku}</p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {p.firstBarcode ?? '—'}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.variantCount}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {p.minRetailPrice === p.maxRetailPrice
                      ? money(p.minRetailPrice)
                      : `${money(p.minRetailPrice)} – ${money(p.maxRetailPrice)}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.trackStock ? (
                      p.totalStock
                    ) : (
                      <span className="text-muted-foreground">Not tracked</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {p.lowStockVariants > 0 && <Badge variant="warning">Low stock</Badge>}
                      {!p.isActive && <Badge variant="secondary">Hidden</Badge>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {total > 0 && (
          <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-2.5 text-sm">
            <span>
              {from}–{to} of {total}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={to >= total}
                onClick={() => update({ page: String(page + 1) })}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
