import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Minus, Plus, Printer, Search, Undo2 } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  REFUND_METHOD_LABELS,
  REFUND_METHODS,
  type Page,
  type RefundMethod,
  type ReturnableSale,
  type SaleReturnDto,
} from '@shoppos/shared';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, qs } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { keys, useMoney, usePublicSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { printReceipt } from '../receipts/print';

export function ReturnsPage() {
  const money = useMoney();
  const [q, setQ] = useState('');
  const query = { q: q || undefined, page: 1, pageSize: 100 };
  const { data, isPending } = useQuery({
    queryKey: ['returns', query],
    queryFn: () => api.get<Page<SaleReturnDto>>(`/returns${qs(query)}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Returns"
        description="Items brought back by customers, and the refunds given."
        actions={
          <Button asChild>
            <Link to="/returns/new">
              <Undo2 /> New return
            </Link>
          </Button>
        }
      />
      <Card className="gap-0 py-0">
        <div className="border-b p-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value.trim())}
            placeholder="Return or bill number"
            className="max-w-sm"
          />
        </div>
        {!isPending && !data?.total ? (
          <EmptyState icon={Undo2} title="No returns" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return</TableHead>
                <TableHead>Bill</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Refund</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.number}</TableCell>
                  <TableCell className="font-mono text-sm">{r.sale.number}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                    <span className="block text-xs">{r.user.fullName}</span>
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-sm">
                    {r.items
                      .map((i) => `${i.qty} × ${i.name}${i.restock ? '' : ' (damaged)'}`)
                      .join(', ')}
                    <span className="text-muted-foreground block text-xs">{r.reason}</span>
                  </TableCell>
                  <TableCell>
                    {REFUND_METHOD_LABELS[r.refundMethod as RefundMethod] ?? r.refundMethod}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(r.total)}
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

/** Estimated refund for one line (the server works out the exact cents). */
function estimate(lineTotal: number, soldQty: number, returnedBefore: number, qty: number) {
  return (
    Math.round((lineTotal * (returnedBefore + qty)) / soldQty) -
    Math.round((lineTotal * returnedBefore) / soldQty)
  );
}

export function NewReturnPage() {
  const money = useMoney();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const branding = useBranding();
  const [params] = useSearchParams();
  const [billInput, setBillInput] = useState(params.get('bill') ?? '');
  const [bill, setBill] = useState(params.get('bill') ?? '');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<RefundMethod>('CASH');

  const {
    data: sale,
    error,
    isFetching,
  } = useQuery({
    queryKey: ['returnable', bill],
    queryFn: () => api.get<ReturnableSale>(`/sales/${encodeURIComponent(bill)}/returnable`),
    enabled: !!bill,
    retry: false,
    meta: { silent: true },
  });
  // Quantities are kept per bill line, so another bill never reuses them.

  const chosen = sale?.items.filter((i) => (qtys[i.saleItemId] ?? 0) > 0) ?? [];
  const refund = chosen.reduce(
    (s, i) => s + estimate(i.lineTotal, i.soldQty, i.returnedQty, qtys[i.saleItemId]!),
    0,
  );

  const submit = useMutation({
    mutationFn: () =>
      api.post<SaleReturnDto>('/returns', {
        saleId: sale!.saleId,
        reason,
        refundMethod: method,
        items: chosen.map((i) => ({
          saleItemId: i.saleItemId,
          qty: qtys[i.saleItemId],
          restock: !damaged[i.saleItemId],
        })),
      }),
    onSuccess: async (ret) => {
      toast.success(
        `${ret.number}: refund ${money(ret.total)} by ${REFUND_METHOD_LABELS[method].toLowerCase()}`,
      );
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: keys.posIndex });
      printReceipt(ret.id, {
        mode: settings?.printer.mode ?? 'browser',
        kind: 'returns',
        openDrawer: method === 'CASH',
        logo: branding.logo,
      }).catch((err) =>
        toast.error(err instanceof ApiError ? err.message : 'Could not print the return slip'),
      );
      navigate('/returns');
    },
  });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/returns">
          <ArrowLeft /> Returns
        </Link>
      </Button>
      <PageHeader
        title="New return"
        description="Scan the barcode on the receipt, or type the bill number."
      />
      <form
        className="mb-5 flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setBill(billInput.trim().toUpperCase());
        }}
      >
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            autoFocus
            value={billInput}
            onChange={(e) => setBillInput(e.target.value)}
            placeholder="INV-2026-000123"
            className="h-11 pl-9 font-mono"
          />
        </div>
        <Button type="submit" size="lg" disabled={!billInput.trim() || isFetching}>
          {isFetching ? <Loader2 className="animate-spin" /> : 'Find bill'}
        </Button>
      </form>

      {error && (
        <p className="text-destructive mb-4 text-sm">
          {error instanceof ApiError ? error.message : 'Bill not found'}
        </p>
      )}

      {sale && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-mono">
                {sale.number}
                {sale.status === 'VOIDED' && <Badge variant="destructive">Voided</Badge>}
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                {new Date(sale.createdAt).toLocaleString()}
                {sale.customer && ` · ${sale.customer.name}`}
              </p>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Item</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-center">Return</TableHead>
                    <TableHead className="text-center">Damaged</TableHead>
                    <TableHead className="pr-5 text-right">Refund</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sale.items.map((i) => {
                    const q = qtys[i.saleItemId] ?? 0;
                    const set = (n: number) =>
                      setQtys((s) => ({
                        ...s,
                        [i.saleItemId]: Math.max(0, Math.min(i.returnableQty, n)),
                      }));
                    return (
                      <TableRow
                        key={i.saleItemId}
                        className={cn(i.returnableQty === 0 && 'opacity-50')}
                      >
                        <TableCell className="max-w-72 pl-5">
                          <p className="truncate font-medium">{i.name}</p>
                          <p className="text-muted-foreground text-xs">
                            {money(i.unitPrice)} each
                            {i.returnedQty > 0 && ` · ${i.returnedQty} already returned`}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{i.soldQty}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              disabled={q <= 0}
                              onClick={() => set(q - 1)}
                              aria-label="One less"
                            >
                              <Minus />
                            </Button>
                            <span className="w-8 text-center font-semibold tabular-nums">{q}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              disabled={q >= i.returnableQty}
                              onClick={() => set(q + 1)}
                              aria-label="One more"
                            >
                              <Plus />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!damaged[i.saleItemId]}
                            disabled={q === 0}
                            onCheckedChange={(v) =>
                              setDamaged((d) => ({ ...d, [i.saleItemId]: !!v }))
                            }
                            aria-label="Damaged, do not put back in stock"
                          />
                        </TableCell>
                        <TableCell className="pr-5 text-right tabular-nums">
                          {q > 0 ? money(estimate(i.lineTotal, i.soldQty, i.returnedQty, q)) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-muted-foreground px-5 pt-3 text-xs">
                The refund is what the customer paid for the item, after discounts. Damaged items
                are not put back in stock.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4">
              <FormField label="Refund by">
                <div className="grid grid-cols-2 gap-2">
                  {REFUND_METHODS.filter((m) => m !== 'ACCOUNT' || sale.customer).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={cn(
                        'rounded-lg border p-2.5 text-sm font-medium',
                        method === m
                          ? 'border-brand bg-accent ring-brand/30 ring-2'
                          : 'hover:bg-muted',
                      )}
                    >
                      {REFUND_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </FormField>
              <FormField label="Why is it returned?">
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Not charging, wrong model"
                />
              </FormField>
              <div className="border-t pt-3">
                <p className="text-muted-foreground text-sm">Refund about</p>
                <p className="text-3xl font-bold tabular-nums">{money(refund)}</p>
              </div>
              <Button
                size="lg"
                disabled={
                  !chosen.length ||
                  reason.trim().length < 3 ||
                  submit.isPending ||
                  sale.status === 'VOIDED'
                }
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? <Loader2 className="animate-spin" /> : <Printer />} Refund and
                print slip
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
