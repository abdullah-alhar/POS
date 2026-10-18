import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Pencil, Plus, Truck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { supplierInputSchema, type SupplierDto } from '@shoppos/shared';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
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
import { api } from '@/lib/api';
import { useMoney } from '@/lib/queries';

export const suppliersKey = ['suppliers'] as const;
export const useSuppliers = () =>
  useQuery({ queryKey: suppliersKey, queryFn: () => api.get<SupplierDto[]>('/suppliers') });

export function SuppliersPage() {
  const money = useMoney();
  const { data = [], isPending } = useSuppliers();
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);
  const [paying, setPaying] = useState<SupplierDto | null>(null);

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from, and how much you still owe them."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add supplier
          </Button>
        }
      />
      <Card className="py-0">
        {!isPending && !data.length ? (
          <EmptyState
            icon={Truck}
            title="No suppliers yet"
            description="Add the companies you buy stock from."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Purchases</TableHead>
                <TableHead className="text-right">You owe</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="font-medium">{s.name}</span>
                    {!s.isActive && (
                      <Badge variant="secondary" className="ml-2">
                        Hidden
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[s.contactName, s.phone].filter(Boolean).join(' · ') || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.purchaseCount}</TableCell>
                  <TableCell
                    className={`text-right font-medium tabular-nums ${s.balance > 0 ? 'text-destructive' : ''}`}
                  >
                    {money(s.balance)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setPaying(s)}>
                      <HandCoins /> Pay
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                      <Pencil /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <SupplierForm
              supplier={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="sm:max-w-sm">
          {paying && <PayForm supplier={paying} onDone={() => setPaying(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

type SupplierForm = z.input<typeof supplierInputSchema>;

function SupplierForm({ supplier, onDone }: { supplier: SupplierDto | null; onDone: () => void }) {
  const qc = useQueryClient();
  const form = useForm<SupplierForm>({
    resolver: zodResolver(supplierInputSchema),
    defaultValues: {
      name: supplier?.name ?? '',
      contactName: supplier?.contactName ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
      address: supplier?.address ?? '',
      notes: supplier?.notes ?? '',
      isActive: supplier?.isActive ?? true,
    },
  });
  const save = useMutation({
    mutationFn: (v: SupplierForm) =>
      supplier ? api.patch(`/suppliers/${supplier.id}`, v) : api.post('/suppliers', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suppliersKey });
      toast.success('Supplier saved');
      onDone();
    },
  });
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{supplier ? `Edit ${supplier.name}` : 'Add supplier'}</DialogTitle>
      </DialogHeader>
      <FormField label="Name" error={e.name?.message}>
        <Input autoFocus {...form.register('name')} />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Contact person">
          <Input {...form.register('contactName')} />
        </FormField>
        <FormField label="Phone">
          <Input {...form.register('phone')} />
        </FormField>
      </div>
      <FormField label="Email">
        <Input type="email" {...form.register('email')} />
      </FormField>
      <FormField label="Address">
        <Textarea rows={2} {...form.register('address')} />
      </FormField>
      <FormField label="Notes">
        <Textarea rows={2} {...form.register('notes')} />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function PayForm({ supplier, onDone }: { supplier: SupplierDto; onDone: () => void }) {
  const qc = useQueryClient();
  const money = useMoney();
  const [amount, setAmount] = useState<number>(Math.max(supplier.balance, 0));
  const [method, setMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'CARD'>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: () =>
      api.post(`/suppliers/${supplier.id}/payments`, {
        amount,
        method,
        reference: reference || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suppliersKey });
      toast.success('Payment recorded');
      onDone();
    },
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount > 0) pay.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Pay {supplier.name}</DialogTitle>
        <DialogDescription>You owe {money(supplier.balance)}.</DialogDescription>
      </DialogHeader>
      <FormField label="Amount">
        <MoneyInput autoFocus value={amount} onChange={setAmount} />
      </FormField>
      <FormField label="Paid by">
        <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="CARD">Card</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Reference (optional)">
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Cheque / transfer number"
        />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={!(amount > 0) || pay.isPending}>
          Record payment
        </Button>
      </DialogFooter>
    </form>
  );
}
