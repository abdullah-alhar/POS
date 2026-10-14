import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Undo2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
  ReceiptText,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  bpToPercentText,
  warrantyEnd,
  warrantyLabel,
  PAYMENT_METHOD_LABELS,
  type Page,
  type SaleDto,
  type SaleListItem,
} from '@marina/shared';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { api, ApiError, qs } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useBranding } from '@/lib/branding';
import { keys, useMoney, usePublicSettings } from '@/lib/queries';
import { printReceipt } from '../receipts/print';

const PAGE_SIZE = 50;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function SalesPage() {
  const money = useMoney();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState<'all' | 'COMPLETED' | 'VOIDED'>('all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  // Searching by bill number looks at every day.
  const query = {
    q: q || undefined,
    from: q ? undefined : from,
    to: q ? undefined : to,
    status,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isPending, isFetching } = useQuery({
    queryKey: ['sales', query],
    queryFn: () => api.get<Page<SaleListItem>>(`/sales${qs(query)}`),
    placeholderData: keepPreviousData,
  });
  const total = data?.total ?? 0;
  const dayTotal =
    data?.items.filter((s) => s.status === 'COMPLETED').reduce((sum, s) => sum + s.total, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Sales history"
        description="Find a bill to see it, print it again or void it. Scan a receipt barcode to find it fast."
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-end gap-3 border-b p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value.trim());
                setPage(1);
              }}
              placeholder="Bill number, IMEI / serial, or customer name / phone"
              className="pl-9"
            />
          </div>
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="w-40"
            disabled={!!q}
            aria-label="From"
          />
          <span className="text-muted-foreground pb-2.5 text-sm">to</span>
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="w-40"
            disabled={!!q}
            aria-label="To"
          />
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as typeof status);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All bills</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="VOIDED">Voided</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!isPending && total === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No bills found"
            description={q ? `Nothing matches "${q}".` : 'No bills for these dates.'}
          />
        ) : (
          <Table className={isFetching ? 'opacity-70' : undefined}>
            <TableHeader>
              <TableRow>
                <TableHead>Bill</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Paid by</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenId(s.id)}>
                  <TableCell className="font-mono text-sm font-medium">{s.number}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{s.cashierName}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.itemCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.methods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' + ')}
                  </TableCell>
                  <TableCell
                    className={`text-right font-semibold tabular-nums ${s.status === 'VOIDED' ? 'text-muted-foreground line-through' : ''}`}
                  >
                    {money(s.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.status === 'VOIDED' && <Badge variant="destructive">Voided</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {total > 0 && (
          <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-2.5 text-sm">
            <span>
              {total} bill(s)
              {!q && (
                <>
                  {' '}
                  · completed on this page:{' '}
                  <span className="text-foreground font-medium">{money(dayTotal)}</span>
                </>
              )}
            </span>
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
                disabled={page * PAGE_SIZE >= total}
                onClick={() => setPage(page + 1)}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
      <SaleDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function SaleDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: sale } = useQuery({
    queryKey: ['sales', 'one', id],
    queryFn: () => api.get<SaleDto>(`/sales/${id}`),
    enabled: !!id,
  });
  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {sale && sale.id === id ? (
          <SaleDetail sale={sale} />
        ) : (
          <Loader2 className="text-muted-foreground mx-auto my-10 animate-spin" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SaleDetail({ sale }: { sale: SaleDto }) {
  const money = useMoney();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const branding = useBranding();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [printing, setPrinting] = useState(false);
  const navigate = useNavigate();
  const can = useCan();

  const voidSale = useMutation({
    mutationFn: () => api.post<SaleDto>(`/sales/${sale.id}/void`, { reason }),
    onSuccess: (updated) => {
      qc.setQueryData(['sales', 'one', sale.id], updated);
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: keys.posIndex });
      toast.success(`${sale.number} voided. The items are back in stock.`);
      setVoiding(false);
    },
  });

  async function reprint() {
    setPrinting(true);
    try {
      await printReceipt(sale.id, {
        mode: settings?.printer.mode ?? 'browser',
        copy: true,
        logo: branding.logo,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not print');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 font-mono">
          {sale.number}
          {sale.status === 'VOIDED' && <Badge variant="destructive">Voided</Badge>}
          {sale.priceMode === 'WHOLESALE' && <Badge variant="secondary">Wholesale</Badge>}
        </DialogTitle>
        <DialogDescription>
          {new Date(sale.createdAt).toLocaleString()} · {sale.cashier.fullName}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-72 overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="max-w-72 whitespace-normal">
                  {i.productName}
                  {i.variantName && (
                    <span className="text-muted-foreground"> – {i.variantName}</span>
                  )}
                  {i.discountAmount > 0 && (
                    <span className="text-success block text-xs">
                      Discount{' '}
                      {i.discountType === 'PERCENT' && i.discountValue
                        ? `${bpToPercentText(i.discountValue)}%`
                        : money(i.discountAmount)}
                    </span>
                  )}
                  {i.serialNo && (
                    <span className="text-muted-foreground block font-mono text-xs">
                      IMEI / SN {i.serialNo}
                    </span>
                  )}
                  {i.warrantyDays > 0 && (
                    <WarrantyNote soldAt={sale.createdAt} days={i.warrantyDays} />
                  )}
                  {i.unitPrice !== i.listPrice && (
                    <span className="text-warning block text-xs">
                      Price changed from {money(i.listPrice)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{money(i.unitPrice)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {money(i.lineTotal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          {sale.payments.map((p, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-muted-foreground">
                {PAYMENT_METHOD_LABELS[p.method]}
                {p.reference && ` (${p.reference})`}
              </span>
              <span className="tabular-nums">{money(p.tendered ?? p.amount)}</span>
            </div>
          ))}
          {sale.changeGiven > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Change</span>
              <span className="tabular-nums">{money(sale.changeGiven)}</span>
            </div>
          )}
        </div>
        <div className="space-y-1 text-sm">
          {sale.itemDiscountTotal + sale.billDiscountAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discounts</span>
              <span className="tabular-nums">
                −{money(sale.itemDiscountTotal + sale.billDiscountAmount)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span className="tabular-nums">{money(sale.total)}</span>
          </div>
        </div>
      </div>

      {sale.status === 'VOIDED' && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
          Voided {sale.voidedAt && new Date(sale.voidedAt).toLocaleString()} by{' '}
          {sale.voidedBy?.fullName}
          {sale.voidApprovedBy && `, approved by ${sale.voidApprovedBy.fullName}`}:{' '}
          {sale.voidReason}
        </div>
      )}

      {voiding ? (
        <form
          className="grid gap-3 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            voidSale.mutate();
          }}
        >
          <FormField
            label="Why is this bill voided?"
            hint="Saved in the audit log. The items go back into stock."
          >
            <Textarea
              autoFocus
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setVoiding(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={reason.trim().length < 3 || voidSale.isPending}
            >
              {voidSale.isPending && <Loader2 className="animate-spin" />} Void bill
            </Button>
          </div>
        </form>
      ) : (
        <DialogFooter>
          {sale.status === 'COMPLETED' && (
            <>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setVoiding(true)}
              >
                <Ban /> Void
              </Button>
              {can('returns.create') && sale.items.some((i) => i.qty > i.returnedQty) && (
                <Button
                  variant="outline"
                  onClick={() => navigate(`/returns/new?bill=${sale.number}`)}
                >
                  <Undo2 /> Return items
                </Button>
              )}
            </>
          )}
          <Button onClick={reprint} disabled={printing}>
            {printing ? <Loader2 className="animate-spin" /> : <Printer />} Print again
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}

/** "Warranty 1 year · until 14/10/2027" in green, or "expired" in red. */
function WarrantyNote({ soldAt, days }: { soldAt: string; days: number }) {
  const end = warrantyEnd(new Date(soldAt), days);
  const [now] = useState(() => Date.now());
  const valid = end.getTime() >= now;
  return (
    <span className={cn('block text-xs', valid ? 'text-success' : 'text-destructive')}>
      Warranty {warrantyLabel(days)} · {valid ? 'until' : 'expired'} {end.toLocaleDateString()}
    </span>
  );
}
