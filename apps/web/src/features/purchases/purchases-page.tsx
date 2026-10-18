import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Loader2,
  PackageCheck,
  Plus,
  Save,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { Page, PosIndexItem, PurchaseDto, PurchaseListItem } from '@shoppos/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { ItemSearch } from '@/components/item-search';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { FullScreenLoader } from '@/app/guards';
import { api, qs } from '@/lib/api';
import { keys, useMoney } from '@/lib/queries';
import { suppliersKey, useSuppliers } from './suppliers-page';

const STATUS: Record<
  PurchaseListItem['status'],
  { label: string; variant: 'secondary' | 'success' | 'destructive' }
> = {
  DRAFT: { label: 'Draft', variant: 'secondary' },
  RECEIVED: { label: 'Received', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

export function PurchasesPage() {
  const money = useMoney();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const query = { status, q: q || undefined, page: 1, pageSize: 100 };
  const { data, isPending } = useQuery({
    queryKey: ['purchases', query],
    queryFn: () => api.get<Page<PurchaseListItem>>(`/purchases${qs(query)}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Supplier invoices. Stock goes up when a purchase is received."
        actions={
          <Button asChild>
            <Link to="/purchases/new">
              <Plus /> New purchase
            </Link>
          </Button>
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap gap-3 border-b p-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search number, invoice or supplier"
            className="max-w-sm"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="DRAFT">Drafts</SelectItem>
              <SelectItem value="RECEIVED">Received</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!isPending && !data?.total ? (
          <EmptyState
            icon={ShoppingCart}
            title="No purchases yet"
            description="Record supplier invoices to add stock and keep costs up to date."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/purchases/${p.id}`)}
                >
                  <TableCell className="font-mono text-sm">{p.number}</TableCell>
                  <TableCell>{p.invoiceDate}</TableCell>
                  <TableCell>
                    {p.supplierName}
                    {p.supplierInvoiceNo && (
                      <span className="text-muted-foreground"> · {p.supplierInvoiceNo}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.itemCount}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(p.total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.status === 'RECEIVED' ? money(p.paidAmount) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}

interface Line {
  variantId: string;
  name: string;
  sku: string;
  qty: string;
  unitCost: number;
}

export function PurchaseEditorPage() {
  const { id = 'new' } = useParams();
  const { data, isPending } = useQuery({
    queryKey: ['purchases', 'one', id],
    queryFn: () => api.get<PurchaseDto>(`/purchases/${id}`),
    enabled: id !== 'new',
  });
  if (id !== 'new' && isPending) return <FullScreenLoader />;
  return <PurchaseEditor key={data?.id ?? 'new'} purchase={data ?? null} />;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function PurchaseEditor({ purchase }: { purchase: PurchaseDto | null }) {
  const money = useMoney();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: suppliers = [] } = useSuppliers();
  const editable = !purchase || purchase.status === 'DRAFT';
  const [supplierId, setSupplierId] = useState(purchase?.supplier.id ?? '');
  const [invoiceNo, setInvoiceNo] = useState(purchase?.supplierInvoiceNo ?? '');
  const [invoiceDate, setInvoiceDate] = useState(purchase?.invoiceDate ?? today());
  const [discount, setDiscount] = useState<number>(purchase?.discount ?? 0);
  const [note, setNote] = useState(purchase?.note ?? '');
  const [lines, setLines] = useState<Line[]>(
    purchase?.items.map((i) => ({
      variantId: i.variantId,
      name: i.name,
      sku: i.sku,
      qty: String(i.qty),
      unitCost: i.unitCost,
    })) ?? [],
  );
  const [confirm, setConfirm] = useState<'receive' | 'cancel' | null>(null);

  const subtotal = lines.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number.isFinite(l.unitCost) ? l.unitCost : 0),
    0,
  );
  const total = subtotal - (Number.isFinite(discount) ? discount : 0);
  const valid =
    !!supplierId &&
    lines.length > 0 &&
    lines.every((l) => Number(l.qty) >= 1 && Number.isFinite(l.unitCost) && l.unitCost >= 0) &&
    Number.isFinite(discount) &&
    discount <= subtotal;

  const body = () => ({
    supplierId,
    supplierInvoiceNo: invoiceNo,
    invoiceDate,
    discount,
    note,
    items: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty), unitCost: l.unitCost })),
  });
  const refresh = (p: PurchaseDto) => {
    qc.setQueryData(['purchases', 'one', p.id], p);
    qc.invalidateQueries({ queryKey: ['purchases'] });
    qc.invalidateQueries({ queryKey: suppliersKey });
  };
  const save = useMutation({
    mutationFn: () =>
      purchase
        ? api.put<PurchaseDto>(`/purchases/${purchase.id}`, body())
        : api.post<PurchaseDto>('/purchases', body()),
    onSuccess: (p) => {
      refresh(p);
      toast.success(`${p.number} saved as a draft`);
      if (!purchase) navigate(`/purchases/${p.id}`, { replace: true });
    },
  });
  const receive = useMutation({
    mutationFn: async () => {
      const saved = purchase
        ? await api.put<PurchaseDto>(`/purchases/${purchase.id}`, body())
        : await api.post<PurchaseDto>('/purchases', body());
      return api.post<PurchaseDto>(`/purchases/${saved.id}/receive`);
    },
    onSuccess: (p) => {
      refresh(p);
      qc.invalidateQueries({ queryKey: keys.posIndex });
      qc.invalidateQueries({ queryKey: keys.products });
      toast.success(`${p.number} received: stock and costs updated`);
      navigate(`/purchases/${p.id}`, { replace: true });
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post<PurchaseDto>(`/purchases/${purchase!.id}/cancel`),
    onSuccess: (p) => {
      refresh(p);
      toast.success('Purchase cancelled');
    },
  });

  function addItem(item: PosIndexItem) {
    setLines((ls) =>
      ls.some((l) => l.variantId === item.variantId)
        ? ls.map((l) =>
            l.variantId === item.variantId ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l,
          )
        : [
            ...ls,
            {
              variantId: item.variantId,
              name: item.name,
              sku: item.sku,
              qty: '1',
              unitCost: Number.NaN,
            },
          ],
    );
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/purchases">
          <ArrowLeft /> Purchases
        </Link>
      </Button>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {purchase ? purchase.number : 'New purchase'}
            {purchase && (
              <Badge variant={STATUS[purchase.status].variant}>
                {STATUS[purchase.status].label}
              </Badge>
            )}
          </span>
        }
        description={
          purchase?.receivedAt
            ? `Received ${new Date(purchase.receivedAt).toLocaleString()} by ${purchase.receivedBy?.fullName}`
            : 'Save as a draft while you check the goods; receive it to add the items to stock.'
        }
        actions={
          editable && (
            <>
              {purchase && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setConfirm('cancel')}
                >
                  <Ban /> Cancel purchase
                </Button>
              )}
              <Button
                variant="outline"
                disabled={!valid || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save draft
              </Button>
              <Button disabled={!valid || receive.isPending} onClick={() => setConfirm('receive')}>
                <PackageCheck /> Receive into stock
              </Button>
            </>
          )
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="gap-3">
          <CardContent className="grid gap-3">
            {editable && (
              <ItemSearch
                onPick={addItem}
                showPrice="none"
                placeholder="Search or scan an item to add to the invoice"
              />
            )}
            {lines.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                Add the items on the supplier's invoice.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Cost each</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    {editable && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => {
                    const update = (patch: Partial<Line>) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    return (
                      <TableRow key={l.variantId}>
                        <TableCell className="max-w-72">
                          <p className="truncate font-medium">{l.name}</p>
                          <p className="text-muted-foreground font-mono text-xs">{l.sku}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          {editable ? (
                            <Input
                              inputMode="numeric"
                              value={l.qty}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => update({ qty: e.target.value.replace(/\D/g, '') })}
                              className="ml-auto h-9 w-20 text-right"
                            />
                          ) : (
                            l.qty
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editable ? (
                            <MoneyInput
                              value={l.unitCost}
                              onChange={(v) => update({ unitCost: v })}
                              className="ml-auto h-9 w-32"
                            />
                          ) : (
                            money(l.unitCost)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {Number.isFinite(l.unitCost)
                            ? money((Number(l.qty) || 0) * l.unitCost)
                            : '—'}
                        </TableCell>
                        {editable && (
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
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            <FormField label="Supplier">
              <Select value={supplierId} onValueChange={setSupplierId} disabled={!editable}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers
                    .filter((s) => s.isActive || s.id === supplierId)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {!suppliers.length && (
                <Link to="/suppliers" className="text-primary text-xs hover:underline">
                  Add a supplier first
                </Link>
              )}
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Invoice no.">
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  disabled={!editable}
                />
              </FormField>
              <FormField label="Date">
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  disabled={!editable}
                />
              </FormField>
            </div>
            <FormField label="Discount on the invoice" hint="Shared over the items' costs">
              <MoneyInput value={discount} onChange={setDiscount} disabled={!editable} />
            </FormField>
            <FormField label="Note">
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={!editable}
              />
            </FormField>
            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{money(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="tabular-nums">−{money(discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="tabular-nums">{money(Math.max(total, 0))}</span>
              </div>
              {purchase?.status === 'RECEIVED' && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="tabular-nums">{money(purchase.paidAmount)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={confirm === 'receive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Receive these goods into stock?"
        description="Stock goes up and each item's average cost is updated. A received purchase cannot be changed."
        confirmText="Receive"
        onConfirm={() => receive.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Cancel this draft?"
        confirmText="Cancel purchase"
        destructive
        onConfirm={() => cancel.mutate()}
      />
    </>
  );
}
