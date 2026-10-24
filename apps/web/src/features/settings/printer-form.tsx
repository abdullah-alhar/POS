import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Globe, Loader2, Monitor, Printer, RefreshCw, Usb, Wallet } from 'lucide-react';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import { toast } from 'sonner';
import {
  printerSettingsSchema,
  type AllSettings,
  type PrinterMode,
  type PrinterSettings,
  type PrintResult,
  receiptHasLogo,
} from '@shoppos/shared';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { keys } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { SaveBar } from './save-bar';
import { buildPrinterLogo } from '../receipts/printer-logo';

const MODES: { mode: PrinterMode; title: string; text: string; icon: typeof Usb }[] = [
  {
    mode: 'windows',
    title: 'Receipt printer (USB)',
    text: 'Recommended. Prints fast and opens the cash drawer.',
    icon: Usb,
  },
  {
    mode: 'network',
    title: 'Network printer',
    text: 'A receipt printer on the shop network (port 9100).',
    icon: Globe,
  },
  {
    mode: 'browser',
    title: 'Chrome printing',
    text: 'Any printer, through Chrome. No cash drawer.',
    icon: Monitor,
  },
  { mode: 'file', title: 'Save to file', text: 'For testing without a printer.', icon: FileText },
];

export function PrinterForm({ settings }: { settings: AllSettings }) {
  const qc = useQueryClient();
  const branding = useBranding();
  const form = useForm<PrinterSettings>({
    resolver: zodResolver(printerSettingsSchema),
    defaultValues: settings.printer,
  });
  const mode = useWatch({ control: form.control, name: 'mode' });

  const save = useMutation({
    mutationFn: async (values: PrinterSettings) => {
      // The printer cannot read PNG/SVG: turn the logo into black-and-white dots now.
      const logo = receiptHasLogo(settings.receipt.layout)
        ? await buildPrinterLogo(branding.logo).catch(() => null)
        : null;
      return api.put<PrinterSettings>('/settings/printer', { ...values, logo });
    },
    onSuccess: (saved) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) =>
        old ? { ...old, printer: saved } : old,
      );
      qc.invalidateQueries({ queryKey: keys.publicSettings });
      form.reset(saved);
      toast.success('Printer settings saved');
    },
  });
  const test = useMutation({
    mutationFn: () => api.post<PrintResult>('/printing/test'),
    onSuccess: (r) => toast.success(`Test receipt sent to ${r.target}`),
  });
  const drawer = useMutation({
    mutationFn: () => api.post<PrintResult>('/printing/open-drawer'),
    onSuccess: () => toast.success('Drawer opened'),
  });
  const dirty = form.formState.isDirty;

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid max-w-4xl gap-5">
      <Card>
        <CardHeader>
          <CardTitle>How receipts are printed</CardTitle>
          <CardDescription>
            If the receipt printer fails, Chrome prints the receipt instead, so a sale is never
            stuck.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Controller
            control={form.control}
            name="mode"
            render={({ field }) => (
              <div className="grid gap-3 sm:grid-cols-2">
                {MODES.map(({ mode: m, title, text, icon: Icon }) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => field.onChange(m)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
                      field.value === m
                        ? 'border-brand bg-accent/60 ring-brand/30 ring-2'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <Icon className="text-brand mt-0.5 size-5 shrink-0" />
                    <span>
                      <span className="block text-sm font-medium">{title}</span>
                      <span className="text-muted-foreground block text-xs">{text}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          />

          {mode === 'windows' && <WindowsPrinterPicker control={form.control} />}
          {mode === 'network' && (
            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <FormField label="Printer address" error={form.formState.errors.networkHost?.message}>
                <Input placeholder="192.168.1.50" {...form.register('networkHost')} />
              </FormField>
              <FormField label="Port" error={form.formState.errors.networkPort?.message}>
                <Input type="number" {...form.register('networkPort', { valueAsNumber: true })} />
              </FormField>
            </div>
          )}
        </CardContent>
      </Card>

      {mode !== 'browser' && (
        <Card>
          <CardHeader>
            <CardTitle>Paper and drawer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="charsPerLine"
              render={({ field }) => (
                <FormField
                  label="Characters per line"
                  hint="Most 80 mm printers: 48. If lines wrap, try 42."
                >
                  <Select
                    value={String(field.value)}
                    onValueChange={(v) => field.onChange(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="48">48 (80 mm, standard)</SelectItem>
                      <SelectItem value="42">42 (80 mm, large font)</SelectItem>
                      <SelectItem value="32">32 (58 mm paper)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <FormField
              label="Blank lines before cutting"
              error={form.formState.errors.feedLines?.message}
            >
              <Input
                type="number"
                min={0}
                max={10}
                {...form.register('feedLines', { valueAsNumber: true })}
              />
            </FormField>
            <SwitchRow
              control={form.control}
              name="autoCut"
              label="Cut the paper after each receipt"
            />
            <SwitchRow
              control={form.control}
              name="openDrawerOnCash"
              label="Open the cash drawer after a cash sale"
            />
          </CardContent>
        </Card>
      )}

      <SaveBar dirty={dirty} saving={save.isPending} floating>
        {mode !== 'browser' && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={dirty || test.isPending}
              title={dirty ? 'Save first, then test' : undefined}
              onClick={() => test.mutate()}
            >
              {test.isPending ? <Loader2 className="animate-spin" /> : <Printer />} Test print
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={dirty || drawer.isPending}
              title={dirty ? 'Save first, then test' : undefined}
              onClick={() => drawer.mutate()}
            >
              <Wallet /> Open drawer
            </Button>
          </>
        )}
      </SaveBar>
    </form>
  );
}

function SwitchRow({
  control,
  name,
  label,
}: {
  control: Control<PrinterSettings>;
  name: 'autoCut' | 'openDrawerOnCash';
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <Label htmlFor={name}>{label}</Label>
          <Switch id={name} checked={field.value} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  );
}

function WindowsPrinterPicker({ control }: { control: Control<PrinterSettings> }) {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['printers'],
    queryFn: () => api.get<{ printers: string[] }>('/printers'),
  });
  const printers = data?.printers ?? [];
  return (
    <Controller
      control={control}
      name="windowsPrinterName"
      render={({ field, fieldState }) => (
        <FormField
          label="Windows printer"
          error={fieldState.error?.message}
          hint={
            printers.length
              ? 'The receipt printer installed in Windows'
              : 'No printers found here. On the shop laptop, install the printer driver first.'
          }
        >
          <div className="flex gap-2">
            {printers.length ? (
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Choose the receipt printer" />
                </SelectTrigger>
                <SelectContent>
                  {printers.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={field.value}
                onChange={field.onChange}
                placeholder="Printer name, e.g. POS-80"
                className="flex-1"
              />
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              aria-label="Look for printers again"
            >
              <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
            </Button>
          </div>
        </FormField>
      )}
    />
  );
}
