import { useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ImageUp, Loader2, Play, RotateCcw, Save } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import {
  BRAND_PRESETS,
  brandingSettingsSchema,
  type AllSettings,
  type BrandingSettings,
  receiptHasLogo,
} from '@shoppos/shared';
import { LOGO_MARK, LOGO_VIEWBOX, LOGO_WORDMARK } from '@/components/brand/logo-paths';
import { replaySplash } from '@/components/brand/brand-splash';
import { FormField } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { applyBranding, readableTextOn } from '@/lib/branding';
import { imageFileToDataUrl } from '@/lib/image';
import { keys } from '@/lib/queries';
import { buildPrinterLogo } from '../receipts/printer-logo';
import { cn } from '@/lib/utils';

/**
 * Branding (Super Admin only): app name, logo, colour and sidebar style.
 * Used to set the app up for each shop.
 */
export function BrandingForm({ settings }: { settings: AllSettings }) {
  const qc = useQueryClient();
  const form = useForm<BrandingSettings>({
    resolver: zodResolver(brandingSettingsSchema),
    defaultValues: settings.branding,
  });
  const values = useWatch({ control: form.control }) as BrandingSettings;
  const save = useMutation({
    mutationFn: async (v: BrandingSettings) => {
      const saved = await api.put<BrandingSettings>('/settings/branding', v);
      // Keep the logo printed on receipts in step with the new logo.
      if (receiptHasLogo(settings.receipt.layout) && settings.printer.mode !== 'browser') {
        const logo = await buildPrinterLogo(saved.logo).catch(() => null);
        if (logo) await api.put('/settings/printer', { ...settings.printer, logo });
      }
      return saved;
    },
    onSuccess: (saved) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) =>
        old ? { ...old, branding: saved } : old,
      );
      qc.invalidateQueries({ queryKey: keys.publicSettings });
      applyBranding(saved);
      form.reset(saved);
      toast.success('Branding saved');
    },
  });
  const e = form.formState.errors;
  const color = /^#[0-9a-f]{6}$/i.test(values.primaryColor ?? '')
    ? values.primaryColor
    : settings.branding.primaryColor;

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]"
    >
      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Name and logo <Badge variant="secondary">Super Admin</Badge>
            </CardTitle>
            <CardDescription>
              Shown on the login screen, the sidebar, the startup animation and receipts.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <FormField label="App name" error={e.appName?.message} hint="Shown in the browser tab">
              <Input {...form.register('appName')} className="max-w-sm" />
            </FormField>
            <Controller
              control={form.control}
              name="logo"
              render={({ field }) => (
                <LogoPicker value={field.value} onChange={field.onChange} error={e.logo?.message} />
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Colour</CardTitle>
            <CardDescription>
              Buttons, highlights and the startup animation use this colour.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Controller
              control={form.control}
              name="primaryColor"
              render={({ field }) => (
                <>
                  <div className="grid grid-cols-5 gap-2.5">
                    {BRAND_PRESETS.map((p) => {
                      const active = field.value?.toLowerCase() === p.color;
                      return (
                        <button
                          key={p.color}
                          type="button"
                          onClick={() => field.onChange(p.color)}
                          className={cn(
                            'flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs transition-colors',
                            active ? 'border-foreground/40 bg-muted' : 'hover:bg-muted/60',
                          )}
                        >
                          <span
                            className="flex size-9 items-center justify-center rounded-full shadow-sm"
                            style={{ background: p.color, color: readableTextOn(p.color) }}
                          >
                            {active && <Check className="size-4" />}
                          </span>
                          <span className="text-muted-foreground leading-tight">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <FormField label="Custom colour" error={e.primaryColor?.message}>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={color}
                        onChange={(ev) => field.onChange(ev.target.value)}
                        className="h-10 w-14 cursor-pointer rounded-md border bg-transparent p-1"
                        aria-label="Pick a colour"
                      />
                      <Input
                        value={field.value ?? ''}
                        onChange={(ev) => field.onChange(ev.target.value)}
                        className="w-32 font-mono uppercase"
                        maxLength={7}
                      />
                    </div>
                  </FormField>
                </>
              )}
            />
            <Controller
              control={form.control}
              name="sidebar"
              render={({ field }) => (
                <FormField label="Sidebar" hint="In dark mode the sidebar is always dark">
                  <div className="grid max-w-md grid-cols-2 gap-3">
                    {(['dark', 'light'] as const).map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => field.onChange(tone)}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border p-3 text-sm font-medium capitalize',
                          field.value === tone
                            ? 'border-brand ring-brand/30 ring-2'
                            : 'hover:bg-muted/60',
                        )}
                      >
                        <span
                          className={cn(
                            'h-8 w-6 rounded border',
                            tone === 'dark' ? 'bg-[#0f0f12]' : 'bg-white',
                          )}
                        />
                        {tone}
                      </button>
                    ))}
                  </div>
                </FormField>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Startup animation</CardTitle>
            <CardDescription>
              The logo animation shown when the POS opens (once per start). Any key skips it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Controller
              control={form.control}
              name="startupAnimation"
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <Switch
                    id="startupAnimation"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Label htmlFor="startupAnimation">Play when the POS opens</Label>
                </div>
              )}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // Preview with the colour being edited, then restore the saved look.
                applyBranding({ ...settings.branding, primaryColor: color });
                replaySplash();
                window.setTimeout(() => applyBranding(settings.branding), 3800);
              }}
            >
              <Play /> Preview
            </Button>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!form.formState.isDirty}
            onClick={() => form.reset(settings.branding)}
          >
            <RotateCcw /> Undo changes
          </Button>
          <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save branding
          </Button>
        </div>
      </div>

      <div className="xl:sticky xl:top-6">
        <p className="text-muted-foreground mb-2 text-sm">Live preview</p>
        <BrandPreview color={color} sidebar={values.sidebar ?? 'dark'} logo={values.logo ?? null} />
      </div>
    </form>
  );
}

function PreviewLogo({ logo, className }: { logo: string | null; className?: string }) {
  if (logo) return <img src={logo} alt="" className={cn('object-contain', className)} />;
  return (
    <svg viewBox={LOGO_VIEWBOX} fill="currentColor" fillRule="evenodd" className={className}>
      {[...LOGO_MARK, ...LOGO_WORDMARK].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** A small mock of the app painted with the colour being edited. */
function BrandPreview({
  color,
  sidebar,
  logo,
}: {
  color: string;
  sidebar: 'dark' | 'light';
  logo: string | null;
}) {
  return (
    <div
      data-sidebar-preview={sidebar}
      style={
        { '--brand': color, '--brand-foreground': readableTextOn(color) } as React.CSSProperties
      }
      className="bg-background flex h-72 overflow-hidden rounded-xl border shadow-sm"
    >
      <div className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-36 shrink-0 flex-col gap-1 border-r p-2.5">
        <PreviewLogo
          logo={logo}
          className="text-sidebar-primary mb-3 h-6 w-auto max-w-full self-start"
        />
        {['Billing', 'Products', 'Settings'].map((item, i) => (
          <div
            key={item}
            className={cn(
              'rounded-md px-2 py-1.5 text-xs',
              i === 0
                ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                : 'text-sidebar-muted',
            )}
          >
            {item}
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-sm font-semibold">Billing</p>
        <div className="bg-card space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between text-xs">
            <span>Anker 20W Charger</span>
            <span className="font-semibold">Rs 4,500</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Retail</Badge>
            <Badge variant="outline">Wholesale</Badge>
            <span className="bg-accent text-accent-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
              −10% discount
            </span>
          </div>
        </div>
        <div className="mt-auto flex gap-2">
          <Button type="button" size="sm" className="flex-1" tabIndex={-1}>
            Pay Rs 4,050
          </Button>
          <Button type="button" size="sm" variant="outline" tabIndex={-1}>
            Hold
          </Button>
        </div>
      </div>
    </div>
  );
}

/** PNG/JPEG/WebP are shrunk to 512 px; SVG is kept sharp as it is. */
function LogoPicker({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  error?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function pick(file: File) {
    setReading(true);
    try {
      onChange(await imageFileToDataUrl(file, { maxSize: 512, type: 'image/png' }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReading(false);
    }
  }

  return (
    <FormField
      label="Logo"
      error={error}
      hint="Best: a PNG with a transparent background, or an SVG"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border">
          <div className="flex h-24 w-44 items-center justify-center bg-[#0f0f12] p-3">
            <PreviewLogo logo={value} className="text-brand max-h-full w-full" />
          </div>
          <div className="flex h-24 w-44 items-center justify-center bg-white p-3">
            <PreviewLogo logo={value} className="text-brand max-h-full w-full" />
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            if (file) void pick(file);
            ev.target.value = '';
          }}
        />
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={reading}
          >
            {reading ? <Loader2 className="animate-spin" /> : <ImageUp />} Upload logo
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <RotateCcw /> Use the built-in logo
            </Button>
          )}
        </div>
      </div>
    </FormField>
  );
}
