import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
} from 'react-hook-form';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  bpToPercentText,
  discountPercentBp,
  productInputSchema,
  type ProductDto,
  type ProductInput,
  type ProductInputParsed,
} from '@shoppos/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FullScreenLoader } from '@/app/guards';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys, useBrands, useCategories, useTaxRates } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { MovementsTable } from '../inventory/stock-page';
import { BarcodesInput } from './barcodes-input';

const NONE = '__none';

type FormValues = ProductInput;
type VariantValues = FormValues['variants'][number];

const blankVariant = (): VariantValues => ({
  name: '',
  attributes: {},
  sku: '',
  barcodes: [],
  generateBarcode: false,
  costPrice: Number.NaN,
  retailPrice: Number.NaN,
  wholesalePrice: Number.NaN,
  reorderLevel: 2,
  openingStock: 0,
  isActive: true,
});

function toFormValues(p: ProductDto): FormValues {
  return {
    name: p.name,
    description: p.description ?? '',
    categoryId: p.categoryId,
    brandId: p.brandId,
    taxRateId: p.taxRateId,
    trackStock: p.trackStock,
    warrantyDays: p.warrantyDays,
    trackSerial: p.trackSerial,
    isActive: p.isActive,
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      attributes: v.attributes,
      sku: v.sku,
      barcodes: v.barcodes,
      generateBarcode: false,
      costPrice: v.costPrice,
      retailPrice: v.retailPrice,
      wholesalePrice: v.wholesalePrice,
      reorderLevel: v.reorderLevel,
      openingStock: 0,
      isActive: v.isActive,
    })),
  };
}

export function ProductEditorPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { data: product, isPending } = useQuery({
    queryKey: keys.product(id),
    queryFn: () => api.get<ProductDto>(`/products/${id}`),
    enabled: !isNew,
  });

  if (!isNew && isPending) return <FullScreenLoader />;
  if (!isNew && !product) return null;
  return <ProductForm key={product?.updatedAt ?? 'new'} product={product ?? null} />;
}

function ProductForm({ product }: { product: ProductDto | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useCan();
  const readOnly = !can('products.manage');
  const { data: categories = [] } = useCategories();
  const { data: brands = [] } = useBrands();
  const { data: taxRates = [] } = useTaxRates();

  const form = useForm<FormValues, unknown, ProductInputParsed>({
    resolver: zodResolver(productInputSchema),
    defaultValues: product
      ? toFormValues(product)
      : {
          name: '',
          description: '',
          categoryId: null,
          brandId: null,
          taxRateId: null,
          trackStock: true,
          warrantyDays: 0,
          trackSerial: false,
          isActive: true,
          variants: [blankVariant()],
        },
  });
  const { control, register, handleSubmit, formState } = form;
  const variants = useFieldArray({ control, name: 'variants', keyName: 'key' });
  const stockById = useMemo(
    () => new Map(product?.variants.map((v) => [v.id, v.stockQty]) ?? []),
    [product],
  );

  const save = useMutation({
    mutationFn: (values: ProductInputParsed) =>
      product
        ? api.put<ProductDto>(`/products/${product.id}`, values)
        : api.post<ProductDto>('/products', values),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: keys.products });
      qc.invalidateQueries({ queryKey: keys.posIndex });
      qc.setQueryData(keys.product(saved.id), saved);
      toast.success(product ? 'Product saved' : 'Product added');
      form.reset(toFormValues(saved));
      if (!product) navigate(`/products/${saved.id}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [path, message] of Object.entries(err.fields)) {
          form.setError(path as never, { message });
        }
      }
    },
  });

  const submit = handleSubmit((values) => save.mutate(values));

  // Ctrl+S saves.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!readOnly) void submit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, readOnly]);

  const blocker = useBlocker(formState.isDirty && !save.isPending && !save.isSuccess);
  const e = formState.errors;

  return (
    <form onSubmit={submit} noValidate>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/products">
          <ArrowLeft /> Products
        </Link>
      </Button>
      <PageHeader
        title={product ? product.name : 'New product'}
        description={
          product
            ? 'Edit details, variants and prices.'
            : 'Add a product with one or more variants.'
        }
        actions={
          !readOnly && (
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save
              <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 text-[10px] lg:inline">
                Ctrl S
              </kbd>
            </Button>
          )
        }
      />

      <fieldset disabled={readOnly} className="grid min-w-0 grid-cols-1 gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <FormField label="Product name" error={e.name?.message} className="md:col-span-3">
              <Input
                autoFocus={!product}
                placeholder="e.g. Anker 20W USB-C Charger"
                {...register('name')}
              />
            </FormField>
            <LookupSelect
              control={control}
              name="categoryId"
              label="Category"
              noneLabel="No category"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <LookupSelect
              control={control}
              name="brandId"
              label="Brand"
              noneLabel="No brand"
              options={brands.map((b) => ({ value: b.id, label: b.name }))}
            />
            <LookupSelect
              control={control}
              name="taxRateId"
              label="Tax"
              noneLabel="Default tax rate"
              options={taxRates.map((t) => ({
                value: t.id,
                label: `${t.name} (${bpToPercentText(t.rateBp)}%)`,
              }))}
            />
            <FormField
              label="Description (optional)"
              error={e.description?.message}
              className="md:col-span-3"
            >
              <Textarea rows={2} {...register('description')} />
            </FormField>
            <div className="flex flex-wrap gap-8 md:col-span-3">
              <SwitchField
                control={control}
                name="trackStock"
                label="Track stock"
                hint="Count how many are in the shop"
              />
              <SwitchField
                control={control}
                name="isActive"
                label="Active"
                hint="Hidden products cannot be sold"
              />
              <SwitchField
                control={control}
                name="trackSerial"
                label="Serial number / IMEI"
                hint="Ask for it at the till; printed on the receipt"
              />
              <Controller
                control={control}
                name="warrantyDays"
                render={({ field }) => (
                  <div className="grid gap-1">
                    <Label>Warranty</Label>
                    <Select
                      value={String(field.value ?? 0)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WARRANTY_CHOICES.map(([days, label]) => (
                          <SelectItem key={days} value={String(days)}>
                            {label}
                          </SelectItem>
                        ))}
                        {!WARRANTY_CHOICES.some(([d]) => d === (field.value ?? 0)) && (
                          <SelectItem value={String(field.value)}>{field.value} days</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Variants & prices</CardTitle>
            <CardDescription>
              One line per colour, size or model. Leave SKU empty to create one automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs tracking-wide uppercase">
                  <th className="px-3 pb-2 pl-5 font-medium">Variant</th>
                  <th className="px-2 pb-2 font-medium">SKU</th>
                  <th className="px-2 pb-2 font-medium">Barcodes</th>
                  <th className="px-2 pb-2 text-right font-medium">Cost</th>
                  <th className="px-2 pb-2 text-right font-medium">Retail</th>
                  <th className="px-2 pb-2 text-right font-medium">Wholesale</th>
                  <th className="px-2 pb-2 text-right font-medium">Reorder at</th>
                  <th className="px-2 pb-2 text-right font-medium">Stock</th>
                  <th className="px-3 pb-2 pr-5 text-right font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {variants.fields.map((field, i) => (
                  <VariantRow
                    key={field.key}
                    index={i}
                    control={control}
                    register={register}
                    errors={e.variants?.[i]}
                    stock={field.id ? stockById.get(field.id) : undefined}
                    isExisting={!!field.id}
                    canRemove={!field.id && variants.fields.length > 1}
                    onRemove={() => variants.remove(i)}
                  />
                ))}
              </tbody>
            </table>
            {e.variants?.message && (
              <p className="text-destructive px-5 pt-2 text-xs">{e.variants.message}</p>
            )}
            {!readOnly && (
              <div className="px-5 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => variants.append(blankVariant())}
                >
                  <Plus /> Add variant
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </fieldset>

      {product && (
        <Card className="mt-5 gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Stock history</CardTitle>
            <CardDescription>
              Every change to this product's stock: sales, purchases, returns and adjustments.
            </CardDescription>
          </CardHeader>
          <MovementsTable productId={product.id} compact />
        </Card>
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title="Leave without saving?"
        description="Your changes to this product will be lost."
        confirmText="Leave"
        destructive
        onConfirm={() => blocker.proceed?.()}
      />
    </form>
  );
}

function VariantRow({
  index,
  control,
  register,
  errors,
  stock,
  isExisting,
  canRemove,
  onRemove,
}: {
  index: number;
  control: Control<FormValues, unknown, ProductInputParsed>;
  register: ReturnType<typeof useForm<FormValues, unknown, ProductInputParsed>>['register'];
  errors?: FieldErrors<VariantValues>;
  stock?: number;
  isExisting: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const [cost, retail, active, trackStock] = useWatch({
    control,
    name: [
      `variants.${index}.costPrice`,
      `variants.${index}.retailPrice`,
      `variants.${index}.isActive`,
      'trackStock',
    ],
  });
  const margin =
    Number.isFinite(cost) && Number.isFinite(retail) && retail! > 0
      ? discountPercentBp(retail! - cost!, retail!)
      : null;

  return (
    <tr className={cn('border-b align-top last:border-0', active === false && 'opacity-60')}>
      <td className="py-2.5 pr-2 pl-5">
        <Input placeholder="e.g. Black" className="w-32" {...register(`variants.${index}.name`)} />
        <FieldError message={errors?.name?.message} />
      </td>
      <td className="px-2 py-2.5">
        <Input
          placeholder="Auto"
          className="w-24 font-mono text-xs uppercase"
          {...register(`variants.${index}.sku`)}
        />
        <FieldError message={errors?.sku?.message} />
      </td>
      <td className="px-2 py-2.5">
        <Controller
          control={control}
          name={`variants.${index}.barcodes`}
          render={({ field }) => (
            <BarcodesInput value={field.value ?? []} onChange={field.onChange} />
          )}
        />
        <FieldError message={errors?.barcodes?.message ?? errors?.barcodes?.[0]?.message} />
      </td>
      {(['costPrice', 'retailPrice', 'wholesalePrice'] as const).map((name) => (
        <td key={name} className="px-2 py-2.5">
          <Controller
            control={control}
            name={`variants.${index}.${name}`}
            render={({ field }) => (
              <MoneyInput
                className="w-28"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={!!errors?.[name]}
              />
            )}
          />
          <FieldError message={errors?.[name]?.message} />
          {name === 'retailPrice' && margin !== null && (
            <p
              className={cn(
                'mt-1 text-right text-xs',
                margin < 0 ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {margin < 0 ? 'Below cost!' : `Margin ${bpToPercentText(margin)}%`}
            </p>
          )}
        </td>
      ))}
      <td className="px-2 py-2.5">
        <Input
          type="number"
          min={0}
          className="w-18 text-right"
          {...register(`variants.${index}.reorderLevel`, { valueAsNumber: true })}
        />
        <FieldError message={errors?.reorderLevel?.message} />
      </td>
      <td className="px-2 py-2.5 text-right">
        {isExisting ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex h-10 items-center font-medium tabular-nums">
                {trackStock ? (stock ?? 0) : '—'}
              </span>
            </TooltipTrigger>
            <TooltipContent>Change stock with a stock adjustment or a purchase</TooltipContent>
          </Tooltip>
        ) : trackStock ? (
          <>
            <Input
              type="number"
              min={0}
              title="Opening stock"
              className="w-18 text-right"
              {...register(`variants.${index}.openingStock`, { valueAsNumber: true })}
            />
            <p className="text-muted-foreground mt-1 text-xs">Opening</p>
          </>
        ) : (
          <span className="inline-flex h-10 items-center">—</span>
        )}
      </td>
      <td className="py-2.5 pr-5 pl-2">
        <div className="flex h-10 items-center justify-end gap-1">
          {canRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              aria-label="Remove variant"
            >
              <Trash2 />
            </Button>
          ) : (
            <Controller
              control={control}
              name={`variants.${index}.isActive`}
              render={({ field }) => (
                <Switch
                  checked={field.value ?? true}
                  onCheckedChange={field.onChange}
                  aria-label="Active"
                />
              )}
            />
          )}
        </div>
        {active === false && (
          <Badge variant="secondary" className="float-right">
            Hidden
          </Badge>
        )}
      </td>
    </tr>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-destructive mt-1 max-w-40 text-xs">{message}</p>;
}

function LookupSelect({
  control,
  name,
  label,
  noneLabel,
  options,
}: {
  control: Control<FormValues, unknown, ProductInputParsed>;
  name: 'categoryId' | 'brandId' | 'taxRateId';
  label: string;
  noneLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FormField label={label}>
          <Select
            value={field.value ?? NONE}
            onValueChange={(v) => field.onChange(v === NONE ? null : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{noneLabel}</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
    />
  );
}

function SwitchField({
  control,
  name,
  label,
  hint,
}: {
  control: Control<FormValues, unknown, ProductInputParsed>;
  name: 'trackStock' | 'isActive' | 'trackSerial';
  label: string;
  hint: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-center gap-3">
          <Switch
            id={name}
            checked={field.value ?? name !== 'trackSerial'}
            onCheckedChange={field.onChange}
          />
          <div>
            <Label htmlFor={name}>{label}</Label>
            <p className="text-muted-foreground text-xs">{hint}</p>
          </div>
        </div>
      )}
    />
  );
}

/** Warranty periods shops in Sri Lanka usually give. */
const WARRANTY_CHOICES: [number, string][] = [
  [0, 'No warranty'],
  [7, '7 days (checking)'],
  [14, '14 days'],
  [30, '1 month'],
  [91, '3 months'],
  [182, '6 months'],
  [365, '1 year'],
  [730, '2 years'],
  [1095, '3 years'],
];
