import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Loader2,
  PackageCheck,
  Plus,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  ADJUSTMENT_REASON_LABELS,
  ADJUSTMENT_REASONS,
  STOCK_MOVEMENT_LABELS,
  type AdjustmentReason,
  type LowStockItem,
  type Page,
  type PosIndexItem,
  type StockAdjustmentDto,
  type StockMovementDto,
} from '@marina/shared';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { ItemSearch } from '@/components/item-search';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys, useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function StockPage() {
  const can = useCan();
  const [adjusting, setAdjusting] = useState(false);
  return (
    <>
      <PageHeader
        title="Stock"
        description="What is running low, every stock change, and corrections after a count."
        actions={
          can('stock.adjust') && (
            <Button onClick={() => setAdjusting(true)}>
              <Plus /> Adjust stock
            </Button>
          )
        }
      />
      <Tabs defaultValue="low">
        <TabsList>
          <TabsTrigger value="low">Low stock</TabsTrigger>
          <TabsTrigger value="movements">Stock history</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
        </TabsList>
        <TabsContent value="low">
          <LowStockTab />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab />
        </TabsContent>
        <TabsContent value="adjustments">
          <AdjustmentsTab />
        </TabsContent>
      </Tabs>
      <AdjustDialog open={adjusting} onClose={() => setAdjusting(false)} />
    </>
  );
}

function LowStockTab() {
  const money = useMoney();
  const { data = [], isPending } = useQuery({
    queryKey: ['stock', 'low'],
    queryFn: () => api.get<LowStockItem[]>('/stock/low-stock'),
  });
  if (!isPending && !data.length) {
    return (
      <Card>
        <EmptyState
          icon={PackageCheck}
          title="Nothing is running low"
          description="Items appear here when stock reaches their reorder level."
        />
      </Card>
    );
  }
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">In stock</TableHead>
            <TableHead className="text-right">Reorder at</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Retail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((i) => (
            <TableRow key={i.variantId}>
              <TableCell>
                <Link to={`/products/${i.productId}`} className="font-medium hover:underline">
                  {i.name}
                </Link>
                <p className="text-muted-foreground font-mono text-xs">{i.sku}</p>
              </TableCell>
              <TableCell className="text-right">
                <Badge
                  variant={i.stockQty <= 0 ? 'destructive' : 'warning'}
                  className="tabular-nums"
                >
                  {i.stockQty}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{i.reorderLevel}</TableCell>
              <TableCell className="text-right tabular-nums">{money(i.costPrice)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(i.retailPrice)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export function MovementsTable({ productId, compact }: { productId?: string; compact?: boolean }) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const query = {
    productId,
    type: type === 'all' ? undefined : type,
    page,
    pageSize: compact ? 10 : 50,
  };
  const { data, isPending } = useQuery({
    queryKey: ['stock', 'movements', query],
    queryFn: () => api.get<Page<StockMovementDto>>(`/stock/movements${qs(query)}`),
    placeholderData: keepPreviousData,
  });
  const total = data?.total ?? 0;
  return (
    <>
      {!compact && (
        <div className="flex items-center gap-3 border-b p-3">
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All changes</SelectItem>
              {Object.entries(STOCK_MOVEMENT_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {!isPending && !total ? (
        <EmptyState icon={ClipboardList} title="No stock changes yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              {!productId && <TableHead>Item</TableHead>}
              {productId && <TableHead>Variant</TableHead>}
              <TableHead>What</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Stock after</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-muted-foreground">
                  {new Date(m.createdAt).toLocaleString()}
                </TableCell>
                {!productId && (
                  <TableCell className="max-w-72 truncate">
                    {m.variantName ? `${m.productName} – ${m.variantName}` : m.productName}
                  </TableCell>
                )}
                {productId && <TableCell>{m.variantName || '—'}</TableCell>}
                <TableCell>
                  {STOCK_MOVEMENT_LABELS[m.type] ?? m.type}
                  {m.reference && <span className="text-muted-foreground"> · {m.reference}</span>}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-medium tabular-nums',
                    m.qtyChange > 0 ? 'text-success' : 'text-destructive',
                  )}
                >
                  {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.qtyAfter}</TableCell>
                <TableCell className="text-muted-foreground">{m.userName ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {total > query.pageSize && (
        <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-2.5 text-sm">
          <span>{total} change(s)</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page * query.pageSize >= total}
              onClick={() => setPage(page + 1)}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function MovementsTab() {
  return (
    <Card className="gap-0 py-0">
      <MovementsTable />
    </Card>
  );
}

function AdjustmentsTab() {
  const { data, isPending } = useQuery({
    queryKey: ['stock', 'adjustments'],
    queryFn: () => api.get<Page<StockAdjustmentDto>>('/stock/adjustments'),
  });
  if (!isPending && !data?.total) {
    return (
      <Card>
        <EmptyState icon={ClipboardList} title="No adjustments yet" />
      </Card>
    );
  }
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Number</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-mono text-sm">{a.number}</TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(a.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>
                {ADJUSTMENT_REASON_LABELS[a.reason as AdjustmentReason] ?? a.reason}
                {a.note && <span className="text-muted-foreground block text-xs">{a.note}</span>}
              </TableCell>
              <TableCell className="max-w-96 whitespace-normal">
                {a.items.map((i) => (
                  <span key={i.variantId} className="mr-3 inline-block text-sm">
                    {i.name}{' '}
                    <span
                      className={cn(
                        'font-medium',
                        i.qtyChange > 0 ? 'text-success' : 'text-destructive',
                      )}
                    >
                      {i.qtyChange > 0 ? `+${i.qtyChange}` : i.qtyChange}
                    </span>
                  </span>
                ))}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {a.user.fullName}
                {a.approvedBy && (
                  <span className="block text-xs">approved by {a.approvedBy.fullName}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

interface AdjustLine {
  item: PosIndexItem;
  mode: 'COUNT' | 'ADD' | 'REMOVE';
  qty: string;
}

function AdjustDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<AdjustLine[]>([]);
  const [reason, setReason] = useState<AdjustmentReason>('COUNT_CORRECTION');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post<StockAdjustmentDto>('/stock/adjustments', {
        reason,
        note,
        items: lines.map((l) => ({
          variantId: l.item.variantId,
          mode: l.mode === 'COUNT' ? 'COUNT' : 'CHANGE',
          qty: l.mode === 'REMOVE' ? -Number(l.qty) : Number(l.qty),
        })),
      }),
    onSuccess: (adj) => {
      toast.success(`${adj.number} saved`);
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: keys.posIndex });
      qc.invalidateQueries({ queryKey: keys.products });
      setLines([]);
      setNote('');
      onClose();
    },
  });

  const valid =
    lines.length > 0 &&
    lines.every((l) => /^\d+$/.test(l.qty) && (l.mode === 'COUNT' || Number(l.qty) > 0));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            Type the counted number, or add / remove items (damaged, lost, found).
          </DialogDescription>
        </DialogHeader>
        <ItemSearch
          autoFocus
          showPrice="none"
          onPick={(item) =>
            setLines((ls) =>
              ls.some((l) => l.item.variantId === item.variantId)
                ? ls
                : [...ls, { item, mode: 'COUNT', qty: String(Math.max(item.stockQty, 0)) }],
            )
          }
        />
        {lines.length > 0 && (
          <div className="max-h-80 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Now</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => {
                  const n = Number(l.qty) || 0;
                  const after =
                    l.mode === 'COUNT'
                      ? n
                      : l.mode === 'ADD'
                        ? l.item.stockQty + n
                        : l.item.stockQty - n;
                  const update = (patch: Partial<AdjustLine>) =>
                    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <TableRow key={l.item.variantId}>
                      <TableCell className="max-w-56 truncate">{l.item.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.item.stockQty}</TableCell>
                      <TableCell>
                        <Select
                          value={l.mode}
                          onValueChange={(v) =>
                            update({
                              mode: v as AdjustLine['mode'],
                              qty: v === 'COUNT' ? String(Math.max(l.item.stockQty, 0)) : '1',
                            })
                          }
                        >
                          <SelectTrigger size="sm" className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="COUNT">Counted</SelectItem>
                            <SelectItem value="ADD">Add</SelectItem>
                            <SelectItem value="REMOVE">Remove</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          inputMode="numeric"
                          value={l.qty}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => update({ qty: e.target.value.replace(/\D/g, '') })}
                          className="ml-auto h-8 w-20 text-right"
                        />
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-medium tabular-nums',
                          after < 0 && 'text-destructive',
                        )}
                      >
                        {after}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                          aria-label="Remove line"
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Reason">
            <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ADJUSTMENT_REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
