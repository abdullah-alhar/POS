import { z } from 'zod';
import { bpSchema, centsSchema, optionalText, pageQuerySchema, queryBool } from './common';

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  parentId: z.uuid().nullable().default(null),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
});
export type BrandInput = z.infer<typeof brandInputSchema>;

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(40),
  rateBp: bpSchema,
  isDefault: z.boolean().default(false),
});
export type TaxRateInput = z.infer<typeof taxRateInputSchema>;

/** Barcodes: printable characters, no spaces (EAN, UPC, Code 128 …). */
export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[\x21-\x7E]{3,64}$/, 'Barcode must be 3–64 characters with no spaces');

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9._/-]{1,40}$/, 'SKU: up to 40 letters, numbers or . _ / -');

export const variantInputSchema = z.object({
  /** Present when editing an existing variant. */
  id: z.uuid().optional(),
  /** e.g. "Black", "iPhone 15 / Clear". Empty for products with a single variant. */
  name: z.string().trim().max(80).default(''),
  attributes: z.record(z.string(), z.string().max(60)).default({}),
  /** Left empty → generated automatically. */
  sku: skuSchema.optional().or(z.literal('').transform(() => undefined)),
  barcodes: z.array(barcodeSchema).max(10).default([]),
  /** Create an in-store EAN-13 barcode for this variant. */
  generateBarcode: z.boolean().default(false),
  costPrice: centsSchema,
  retailPrice: centsSchema,
  wholesalePrice: centsSchema,
  reorderLevel: z.int().min(0).max(1_000_000).default(0),
  /** Only used when the variant is created. Later changes go through stock adjustments. */
  openingStock: z.int().min(0).max(1_000_000).default(0),
  isActive: z.boolean().default(true),
});
export type VariantInput = z.input<typeof variantInputSchema>;

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter the product name').max(120),
    description: optionalText(1000),
    categoryId: z.uuid().nullable().default(null),
    brandId: z.uuid().nullable().default(null),
    taxRateId: z.uuid().nullable().default(null),
    trackStock: z.boolean().default(true),
    /** Warranty in days (0 = none): 7 days, 6 months = 182, 1 year = 365 … */
    warrantyDays: z.int().min(0).max(3650).default(0),
    /** Ask for the serial number / IMEI when this item is sold. */
    trackSerial: z.boolean().default(false),
    isActive: z.boolean().default(true),
    variants: z.array(variantInputSchema).min(1, 'A product needs at least one variant').max(200),
  })
  .superRefine((p, ctx) => {
    const seen = new Map<string, number>();
    p.variants.forEach((v, i) => {
      for (const code of v.barcodes) {
        if (seen.has(code)) {
          ctx.addIssue({
            code: 'custom',
            path: ['variants', i, 'barcodes'],
            message: `Barcode ${code} is used twice in this product`,
          });
        }
        seen.set(code, i);
      }
    });
  });
export type ProductInput = z.input<typeof productInputSchema>;
export type ProductInputParsed = z.output<typeof productInputSchema>;

export const productQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  lowStock: queryBool.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  sort: z.enum(['name', 'updated', 'stock']).default('name'),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

export const generateBarcodesSchema = z.object({
  count: z.int().min(1).max(500).default(1),
});

export const variantPricesSchema = z
  .object({
    costPrice: centsSchema.optional(),
    retailPrice: centsSchema.optional(),
    wholesalePrice: centsSchema.optional(),
  })
  .refine(
    (v) =>
      v.costPrice !== undefined || v.retailPrice !== undefined || v.wholesalePrice !== undefined,
    'Enter at least one price',
  );
export type VariantPricesInput = z.infer<typeof variantPricesSchema>;
