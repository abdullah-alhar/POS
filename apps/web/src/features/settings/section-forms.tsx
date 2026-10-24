import { useEffect, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GitCompareArrows,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Star,
  Sun,
  Trash2,
  Undo2,
} from 'lucide-react';
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
  DEFAULT_SETTINGS,
  diffSettings,
  parsePercent,
  SETTINGS_SCHEMAS,
  type AllSettings,
  type SettingsSection,
} from '@shoppos/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { keys, useTaxRates } from '@/lib/queries';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { DiffTable } from './diff-table';
import { SaveBar } from './save-bar';

/**
 * One form per settings section, checked with the same rules the server uses. When the settings
 * change elsewhere (the assistant, restoring a version) a form without unsaved typing follows.
 */
function useSectionForm<K extends SettingsSection>(section: K, settings: AllSettings) {
  const qc = useQueryClient();
  const saved = settings[section];
  const form = useForm<AllSettings[K]>({
    resolver: zodResolver(SETTINGS_SCHEMAS[section] as never),
    defaultValues: saved as never,
  });
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(saved as never);
  }, [saved, form]);
  const save = useMutation({
    mutationFn: (value: AllSettings[K]) => api.put<AllSettings[K]>(`/settings/${section}`, value),
    onSuccess: (value) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) =>
        old ? { ...old, [section]: value } : old,
      );
      qc.invalidateQueries({ queryKey: keys.publicSettings });
      qc.invalidateQueries({ queryKey: keys.posIndex });
      qc.invalidateQueries({ queryKey: ['settings-history'] });
      form.reset(value as never);
      toast.success('Settings saved');
    },
  });
  return {
    form,
    save,
    section,
    saved,
    submit: form.handleSubmit((v) => save.mutate(v as AllSettings[K])),
  };
}

type SectionForm = ReturnType<typeof useSectionForm>;

/**
 * A card with one settings section. While there are unsaved changes it shows them and lets you
 * compare with what is saved, undo them, or go back to the shop defaults.
 */
function SectionCard({
  title,
  description,
  sf,
  children,
  className,
}: {
  title: string;
  description?: string;
  sf: SectionForm;
  children: ReactNode;
  className?: string;
}) {
  const { form, save, section, saved, submit } = sf;
  const values = useWatch({ control: form.control });
  const dirty = form.formState.isDirty;
  const [compare, setCompare] = useState(false);
  const [defaults, setDefaults] = useState(false);
  const rows = dirty ? diffSettings({ [section]: saved }, { [section]: values }) : [];
  const toDefaults = diffSettings({ [section]: values }, { [section]: DEFAULT_SETTINGS[section] });

  return (
    <Card className={cn('pb-0', className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="grid gap-5"
      >
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4">{children}</CardContent>
        <SaveBar dirty={dirty && rows.length > 0} count={rows.length} saving={save.isPending}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!toDefaults.length}
            onClick={() => setDefaults(true)}
            title="Put back the values a new shop starts with"
          >
            <RotateCcw /> Defaults
          </Button>
          {dirty && rows.length > 0 && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCompare(true)}>
                <GitCompareArrows /> Compare
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => form.reset()}>
                <Undo2 /> Undo
              </Button>
            </>
          )}
        </SaveBar>
      </form>
      <Dialog open={compare} onOpenChange={setCompare}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}: not saved yet</DialogTitle>
            <DialogDescription>What will change when you press Save.</DialogDescription>
          </DialogHeader>
          <DiffTable rows={rows} beforeLabel="Saved" afterLabel="On the screen" />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={defaults}
        onOpenChange={setDefaults}
        title={`Put back the defaults for ${title.toLowerCase()}?`}
        description={
          <>
            {toDefaults.map((r) => `${r.label}: ${r.before} → ${r.after}`).join('. ')}. Nothing is
            saved until you press Save.
          </>
        }
        confirmText="Use defaults"
        onConfirm={() => {
          form.reset(DEFAULT_SETTINGS[section] as never, { keepDefaultValues: true });
          setDefaults(false);
        }}
      />
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

/** A percentage box for basis points that follows outside changes (defaults, undo). */
function PercentInput({ value, onChange }: { value: number; onChange: (bp: number) => void }) {
  const [text, setText] = useState(bpToPercentText(value));
  // Follow changes from outside (defaults, undo), not the ones made by typing here.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parsePercent(text) !== value && Number.isFinite(value)) setText(bpToPercentText(value));
  }
  return (
    <div className="relative w-32">
      <Input
        value={text}
        inputMode="decimal"
        className="pr-7 text-right"
        onChange={(e) => {
          setText(e.target.value);
          onChange(parsePercent(e.target.value) ?? Number.NaN);
        }}
      />
      <span className="text-muted-foreground absolute inset-y-0 right-3 flex items-center text-sm">
        %
      </span>
    </div>
  );
}

// ── Shop ──

export function ShopForm({ settings }: { settings: AllSettings }) {
  const sf = useSectionForm('shop', settings);
  const { form } = sf;
  const e = form.formState.errors;
  return (
    <SectionCard
      title="Name and contact"
      description="Printed on receipts and reports."
      sf={sf as SectionForm}
    >
      <FormField label="Shop name" error={e.name?.message} hint="Printed at the top of receipts">
        <Input {...form.register('name')} />
      </FormField>
      <FormField label="Address" error={e.address?.message}>
        <Textarea rows={2} {...form.register('address')} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Phone" error={e.phone?.message}>
          <Input {...form.register('phone')} />
        </FormField>
        <FormField label="Email" error={e.email?.message}>
          <Input type="email" {...form.register('email')} />
        </FormField>
      </div>
    </SectionCard>
  );
}

// ── Tax ──

export function TaxForm({ settings }: { settings: AllSettings }) {
  const sf = useSectionForm('tax', settings);
  const { form } = sf;
  const registered = useWatch({ control: form.control, name: 'vatRegistered' });
  return (
    <SectionCard
      title="VAT"
      description="Default is no tax. Turn this on if the shop registers for VAT."
      sf={sf as SectionForm}
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

export function TaxRatesCard() {
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

export function PosForm({ settings }: { settings: AllSettings }) {
  const sf = useSectionForm('pos', settings);
  const { form } = sf;
  return (
    <SectionCard
      title="Prices and selling"
      description="How prices are shown and rounded."
      sf={sf as SectionForm}
    >
      <div className="grid gap-4 sm:grid-cols-3">
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

export function ApprovalsForm({ settings }: { settings: AllSettings }) {
  const sf = useSectionForm('approvals', settings);
  const { form } = sf;
  return (
    <SectionCard
      title="Cashier limits"
      description="Cashiers need an admin to type their PIN for these actions. Admins never need approval."
      sf={sf as SectionForm}
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
            <PercentInput value={field.value} onChange={field.onChange} />
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
                        checked
                          ? ALL_APPROVAL_ACTIONS.filter((x) => x === a || field.value.includes(x))
                          : field.value.filter((x) => x !== a),
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

export function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'Follow Windows', icon: Monitor },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Saved on this computer only.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
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
