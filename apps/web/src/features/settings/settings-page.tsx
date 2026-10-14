import { useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Monitor, Moon, Plus, Save, Star, Sun, Trash2 } from 'lucide-react';
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from 'react-hook-form';
import { toast } from 'sonner';
import {
  ALL_APPROVAL_ACTIONS,
  APPROVAL_ACTIONS,
  bpToPercentText,
  parsePercent,
  SETTINGS_SCHEMAS,
  type AllSettings,
  type SettingsSection,
} from '@marina/shared';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { FullScreenLoader } from '@/app/guards';
import { useCan } from '@/lib/auth';
import { BrandingForm } from './branding-form';
import { PrinterForm } from './printer-form';
import { ReceiptDesigner } from './receipt-designer';
import { api } from '@/lib/api';
import { keys, useSettings, useTaxRates } from '@/lib/queries';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const { data: settings } = useSettings();
  const canBrand = useCan()('branding.manage');
  if (!settings) return <FullScreenLoader />;

  return (
    <>
      <PageHeader title="Settings" description="Set these once; the shop then runs by itself." />
      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="shop">Shop</TabsTrigger>
          <TabsTrigger value="receipt">Receipt</TabsTrigger>
          <TabsTrigger value="printer">Printer</TabsTrigger>
          <TabsTrigger value="rules">Selling rules</TabsTrigger>
          <TabsTrigger value="look">Look</TabsTrigger>
        </TabsList>
        <TabsContent value="shop">
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <ShopForm settings={settings} />
            <div className="grid gap-5">
              <TaxForm settings={settings} />
              <TaxRatesCard />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="receipt">
          <ReceiptDesigner settings={settings} />
        </TabsContent>
        <TabsContent value="printer">
          <PrinterForm settings={settings} />
        </TabsContent>
        <TabsContent value="rules">
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <PosForm settings={settings} />
            <ApprovalsForm settings={settings} />
          </div>
        </TabsContent>
        <TabsContent value="look">
          <div className="grid items-start gap-5">
            <AppearanceCard />
            {canBrand && <BrandingForm settings={settings} />}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

/** One form per settings section, validated with the same Zod schema the server uses. */
function useSectionForm<K extends SettingsSection>(section: K, settings: AllSettings) {
  const qc = useQueryClient();
  const form = useForm<AllSettings[K]>({
    resolver: zodResolver(SETTINGS_SCHEMAS[section] as never),
    defaultValues: settings[section] as never,
  });
  const save = useMutation({
    mutationFn: (value: AllSettings[K]) => api.put<AllSettings[K]>(`/settings/${section}`, value),
    onSuccess: (value) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) =>
        old ? { ...old, [section]: value } : old,
      );
      qc.invalidateQueries({ queryKey: keys.publicSettings });
      qc.invalidateQueries({ queryKey: keys.posIndex });
      form.reset(value as never);
      toast.success('Settings saved');
    },
  });
  return { form, save, submit: form.handleSubmit((v) => save.mutate(v as AllSettings[K])) };
}

function SectionCard({
  title,
  description,
  onSubmit,
  saving,
  dirty,
  children,
  className,
}: {
  title: string;
  description?: string;
  onSubmit: () => void;
  saving: boolean;
  dirty: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="grid gap-5"
      >
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4">{children}</CardContent>
        <div className="flex justify-end px-5">
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SwitchRow<T extends FieldValues>({
  control,
  name,
  label,
  hint,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  hint?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-start justify-between gap-6 rounded-lg border p-3">
          <div>
            <Label htmlFor={name}>{label}</Label>
            {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
          </div>
          <Switch id={name} checked={!!field.value} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  );
}

// ── Shop ──

function ShopForm({ settings }: { settings: AllSettings }) {
  const { form, save, submit } = useSectionForm('shop', settings);
  const e = form.formState.errors;
  return (
    <SectionCard
      title="Shop details"
      description="Printed on receipts and reports."
      onSubmit={submit}
      saving={save.isPending}
      dirty={form.formState.isDirty}
      className="max-w-3xl"
    >
      <div className="grid gap-4">
        <FormField label="Shop name" error={e.name?.message} hint="Printed at the top of receipts">
          <Input {...form.register('name')} />
        </FormField>
        <FormField label="Address" error={e.address?.message}>
          <Textarea rows={2} {...form.register('address')} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Phone" error={e.phone?.message}>
            <Input {...form.register('phone')} />
          </FormField>
          <FormField label="Email" error={e.email?.message}>
            <Input type="email" {...form.register('email')} />
          </FormField>
        </div>
      </div>
    </SectionCard>
  );
}

// ── Receipt ──

// ── Tax ──

function TaxForm({ settings }: { settings: AllSettings }) {
  const { form, save, submit } = useSectionForm('tax', settings);
  const registered = useWatch({ control: form.control, name: 'vatRegistered' });
  return (
    <SectionCard
      title="VAT"
      description="Default is no tax. Turn this on if the shop registers for VAT."
      onSubmit={submit}
      saving={save.isPending}
      dirty={form.formState.isDirty}
    >
      <SwitchRow
        control={form.control}
        name="vatRegistered"
        label="The shop is VAT registered"
        hint="When off, no tax is worked out on bills."
      />
      {registered && (
        <>
          <FormField label="VAT number" error={form.formState.errors.vatNumber?.message}>
            <Input {...form.register('vatNumber')} />
          </FormField>
          <SwitchRow
            control={form.control}
            name="pricesIncludeTax"
            label="Shelf prices include VAT"
            hint="Recommended. VAT is taken out of the price instead of added on top."
          />
          <SwitchRow
            control={form.control}
            name="showTaxOnReceipt"
            label="Show VAT on the receipt"
          />
        </>
      )}
    </SectionCard>
  );
}

function TaxRatesCard() {
  const qc = useQueryClient();
  const { data: rates = [] } = useTaxRates();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.taxRates });
    qc.invalidateQueries({ queryKey: keys.posIndex });
  };
  const create = useMutation({
    mutationFn: () =>
      api.post('/tax-rates', { name, rateBp: parsePercent(rate), isDefault: false }),
    onSuccess: () => {
      setName('');
      setRate('');
      refresh();
      toast.success('Tax rate added');
    },
  });
  const makeDefault = useMutation({
    mutationFn: (r: (typeof rates)[number]) =>
      api.patch(`/tax-rates/${r.id}`, { name: r.name, rateBp: r.rateBp, isDefault: true }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/tax-rates/${id}`),
    onSuccess: refresh,
  });
  const rateBp = parsePercent(rate);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax rates</CardTitle>
        <CardDescription>
          The default rate is used for products that do not choose one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-lg border">
          {rates.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1 font-medium">{r.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {bpToPercentText(r.rateBp)}%
              </span>
              {r.isDefault ? (
                <Badge>Default</Badge>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(r)}>
                    <Star /> Make default
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => remove.mutate(r.id)}
                    aria-label={`Delete ${r.name}`}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, e.g. VAT 18%"
          />
          <div className="relative w-28 shrink-0">
            <Input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="18"
              inputMode="decimal"
              className="pr-7 text-right"
            />
            <span className="text-muted-foreground absolute inset-y-0 right-3 flex items-center text-sm">
              %
            </span>
          </div>
          <Button
            type="submit"
            disabled={
              !name.trim() || rateBp === null || rateBp < 0 || rateBp > 10_000 || create.isPending
            }
          >
            <Plus /> Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Billing behaviour ──

function PosForm({ settings }: { settings: AllSettings }) {
  const { form, save, submit } = useSectionForm('pos', settings);
  return (
    <SectionCard
      title="Billing"
      description="How prices are shown and rounded."
      onSubmit={submit}
      saving={save.isPending}
      dirty={form.formState.isDirty}
      className="max-w-3xl"
    >
      <div className="grid grid-cols-3 gap-4">
        <FormField label="Currency symbol" error={form.formState.errors.currencySymbol?.message}>
          <Input {...form.register('currencySymbol')} />
        </FormField>
        <Controller
          control={form.control}
          name="roundingStep"
          render={({ field }) => (
            <FormField label="Round bill totals to" hint="Discounts are rounded the same way">
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">No rounding (cents)</SelectItem>
                  <SelectItem value="100">Nearest Rs 1</SelectItem>
                  <SelectItem value="500">Nearest Rs 5</SelectItem>
                  <SelectItem value="1000">Nearest Rs 10</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <Controller
          control={form.control}
          name="defaultPriceMode"
          render={({ field }) => (
            <FormField label="New bills start in">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RETAIL">Retail prices</SelectItem>
                  <SelectItem value="WHOLESALE">Wholesale prices</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
      </div>
      <SwitchRow
        control={form.control}
        name="showCents"
        label="Show cents"
        hint="Off: prices show as Rs 1,250. Amounts are always stored exactly."
      />
      <SwitchRow
        control={form.control}
        name="allowZeroStockSale"
        label="Allow selling items with no stock"
        hint="The cashier sees a warning, and the sale is written in the audit log."
      />
      <SwitchRow
        control={form.control}
        name="autoPrintReceipt"
        label="Print the receipt automatically after payment"
      />
      <SwitchRow
        control={form.control}
        name="confirmRemoveItem"
        label="Ask before removing an item from the bill"
        hint="Delete or Backspace removes the selected item; Enter confirms."
      />
      <Controller
        control={form.control}
        name="autoLockMinutes"
        render={({ field }) => (
          <FormField
            label="Lock the screen when nobody uses it for"
            hint="Unlock with your PIN. The bill on the screen is kept."
          >
            <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Never</SelectItem>
                {[2, 5, 10, 15, 30, 60].map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
      />
    </SectionCard>
  );
}

// ── Approvals ──

function ApprovalsForm({ settings }: { settings: AllSettings }) {
  const { form, save, submit } = useSectionForm('approvals', settings);
  const [discountText, setDiscountText] = useState(
    bpToPercentText(settings.approvals.cashierMaxDiscountBp),
  );

  return (
    <SectionCard
      title="Admin approval"
      description="Cashiers need an admin to type their PIN for these actions. Admins never need approval."
      onSubmit={submit}
      saving={save.isPending}
      dirty={form.formState.isDirty}
      className="max-w-3xl"
    >
      <Controller
        control={form.control}
        name="cashierMaxDiscountBp"
        render={({ field, fieldState }) => (
          <FormField
            label="Cashiers can give discounts up to"
            error={fieldState.error?.message}
            hint="Bigger discounts need an admin PIN"
          >
            <div className="relative w-32">
              <Input
                value={discountText}
                inputMode="decimal"
                className="pr-7 text-right"
                onChange={(e) => {
                  setDiscountText(e.target.value);
                  field.onChange(parsePercent(e.target.value) ?? Number.NaN);
                }}
              />
              <span className="text-muted-foreground absolute inset-y-0 right-3 flex items-center text-sm">
                %
              </span>
            </div>
          </FormField>
        )}
      />
      <Controller
        control={form.control}
        name="requireApprovalFor"
        render={({ field }) => (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Ask for an admin PIN to</legend>
            <div className="grid gap-2.5 rounded-lg border p-3 sm:grid-cols-2">
              {ALL_APPROVAL_ACTIONS.map((a) => (
                <label key={a} className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={field.value.includes(a)}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked ? [...field.value, a] : field.value.filter((x) => x !== a),
                      )
                    }
                  />
                  {APPROVAL_ACTIONS[a]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      />
    </SectionCard>
  );
}

// ── Appearance (this computer only) ──

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'Follow Windows', icon: Monitor },
  ];
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Saved on this computer only.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => setTheme(o.value)}
            className={cn(
              'flex flex-col items-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors',
              theme === o.value
                ? 'border-primary bg-primary/5 ring-primary ring-1'
                : 'hover:bg-accent/50',
            )}
          >
            <o.icon className="size-5" />
            {o.label}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
