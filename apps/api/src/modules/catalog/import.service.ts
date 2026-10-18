import { Injectable } from '@nestjs/common';
import {
  formatMoney,
  isAdminRole,
  normalizeBarcode,
  parseMoney,
  type ImportResult,
  type ImportRow,
  type ImportRowResult,
  type ProductImportInput,
} from '@shoppos/shared';
import { badRequest } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';
import { ProductsService, variantLabel } from './products.service';

interface Parsed {
  row: number;
  name: string;
  variant: string;
  sku?: string;
  barcode?: string;
  category?: string;
  brand?: string;
  cost?: number;
  retail?: number;
  wholesale?: number;
  stock?: number;
  reorder?: number;
}

type Plan =
  | { kind: 'create'; p: Parsed }
  | { kind: 'add-variant'; p: Parsed; productId: string }
  | { kind: 'update'; p: Parsed; variantId: string; label: string; priceChanged: boolean };

const blank = (v?: string) => !v || !v.trim();

/** Excel often gives "1250", "1,250.00" or "Rs 1,250"; accept all of them. */
function money(text: string | undefined, label: string, errors: string[]): number | undefined {
  if (blank(text)) return undefined;
  const cents = parseMoney(text!.replace(/^\s*(rs\.?|lkr)\s*/i, ''));
  if (cents === null || cents < 0) {
    errors.push(`${label} "${text}" is not a valid amount`);
    return undefined;
  }
  return cents;
}

function wholeNumber(
  text: string | undefined,
  label: string,
  errors: string[],
): number | undefined {
  if (blank(text)) return undefined;
  const n = Number(text!.replace(/,/g, '').trim());
  if (!Number.isInteger(n) || n < 0) {
    errors.push(`${label} "${text}" must be a whole number`);
    return undefined;
  }
  return n;
}

/**
 * Product import from a spreadsheet. Rows with a known barcode or SKU update that item's prices;
 * other rows create products (rows with the same product name become variants of one product).
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  async run(input: ProductImportInput, actor: Actor): Promise<ImportResult> {
    const results: ImportRowResult[] = [];
    const plans: Plan[] = [];
    const seenCodes = new Map<string, number>();
    const newProductVariants = new Map<string, Set<string>>();

    const barcodes = new Map(
      (
        await this.prisma.barcode.findMany({ include: { variant: { include: { product: true } } } })
      ).map((b) => [b.code, b.variant]),
    );
    const variantsBySku = new Map(
      (await this.prisma.productVariant.findMany({ include: { product: true } })).map((v) => [
        v.sku,
        v,
      ]),
    );
    const productsByName = new Map(
      (await this.prisma.product.findMany({ include: { variants: true } })).map((p) => [
        p.name.toLowerCase(),
        p,
      ]),
    );

    input.rows.forEach((raw: ImportRow, index) => {
      const row = index + 2; // spreadsheet row number (row 1 holds the column names)
      if (Object.values(raw).every((v) => blank(v))) return;
      const errors: string[] = [];
      const p: Parsed = {
        row,
        name: (raw.name ?? '').trim(),
        variant: (raw.variant ?? '').trim(),
        sku: blank(raw.sku) ? undefined : raw.sku!.trim().toUpperCase(),
        barcode: blank(raw.barcode) ? undefined : normalizeBarcode(raw.barcode!),
        category: blank(raw.category) ? undefined : raw.category!.trim(),
        brand: blank(raw.brand) ? undefined : raw.brand!.trim(),
        cost: money(raw.costPrice, 'Cost', errors),
        retail: money(raw.retailPrice, 'Retail price', errors),
        wholesale: money(raw.wholesalePrice, 'Wholesale price', errors),
        stock: wholeNumber(raw.stock, 'Stock', errors),
        reorder: wholeNumber(raw.reorderLevel, 'Reorder level', errors),
      };
      if (p.sku && !/^[A-Z0-9._/-]{1,40}$/.test(p.sku))
        errors.push(`SKU "${p.sku}" may only use letters, numbers and . _ / -`);
      if (p.barcode && !/^[\x21-\x7E]{3,64}$/.test(p.barcode))
        errors.push(`Barcode "${p.barcode}" is not valid`);
      for (const code of [p.sku && `sku:${p.sku}`, p.barcode && `bc:${p.barcode}`].filter(
        Boolean,
      ) as string[]) {
        const first = seenCodes.get(code);
        if (first)
          errors.push(`${code.startsWith('sku') ? 'SKU' : 'Barcode'} is also on row ${first}`);
        else seenCodes.set(code, row);
      }

      const existing =
        (p.barcode && barcodes.get(p.barcode)) || (p.sku && variantsBySku.get(p.sku)) || null;
      const label = existing
        ? variantLabel(existing.product.name, existing.name)
        : p.variant
          ? `${p.name} – ${p.variant}`
          : p.name;
      if (errors.length) {
        results.push({
          row,
          action: 'error',
          name: label || '(no name)',
          message: errors.join('; '),
        });
        return;
      }

      if (existing) {
        const priceChanged =
          (p.cost !== undefined && p.cost !== existing.costPrice) ||
          (p.retail !== undefined && p.retail !== existing.retailPrice) ||
          (p.wholesale !== undefined && p.wholesale !== existing.wholesalePrice);
        const reorderChanged = p.reorder !== undefined && p.reorder !== existing.reorderLevel;
        const changes = [
          p.retail !== undefined &&
            p.retail !== existing.retailPrice &&
            `retail ${formatMoney(existing.retailPrice)} → ${formatMoney(p.retail)}`,
          p.wholesale !== undefined &&
            p.wholesale !== existing.wholesalePrice &&
            `wholesale ${formatMoney(existing.wholesalePrice)} → ${formatMoney(p.wholesale)}`,
          p.cost !== undefined &&
            p.cost !== existing.costPrice &&
            `cost ${formatMoney(existing.costPrice)} → ${formatMoney(p.cost)}`,
          reorderChanged && `reorder level ${existing.reorderLevel} → ${p.reorder}`,
        ].filter(Boolean);
        plans.push({ kind: 'update', p, variantId: existing.id, label, priceChanged });
        results.push({
          row,
          action: 'update',
          name: label,
          message: changes.length
            ? `Update ${changes.join(', ')}${p.stock !== undefined ? ' (stock column ignored: use a stock adjustment)' : ''}`
            : 'No changes',
        });
        return;
      }

      if (!p.name) {
        results.push({
          row,
          action: 'error',
          name: '(no name)',
          message: 'Name is missing (or give the SKU/barcode of an existing item)',
        });
        return;
      }
      if (p.retail === undefined) {
        results.push({ row, action: 'error', name: label, message: 'Retail price is missing' });
        return;
      }
      const key = p.name.toLowerCase();
      const product = productsByName.get(key);
      const variantKey = p.variant.toLowerCase();
      const used =
        newProductVariants.get(key) ??
        new Set(product?.variants.map((v) => v.name.toLowerCase()) ?? []);
      if (used.has(variantKey)) {
        results.push({
          row,
          action: 'error',
          name: label,
          message: p.variant
            ? `"${p.name}" already has a variant "${p.variant}"`
            : `"${p.name}" already exists: add a variant name, or its SKU/barcode to update it`,
        });
        return;
      }
      used.add(variantKey);
      newProductVariants.set(key, used);
      if (product) {
        plans.push({ kind: 'add-variant', p, productId: product.id });
        results.push({
          row,
          action: 'add-variant',
          name: label,
          message: `New variant of "${product.name}"`,
        });
      } else {
        plans.push({ kind: 'create', p });
        results.push({ row, action: 'create', name: label, message: 'New product' });
      }
    });

    const summary = {
      create: results.filter((r) => r.action === 'create').length,
      addVariant: results.filter((r) => r.action === 'add-variant').length,
      update: results.filter((r) => r.action === 'update').length,
      error: results.filter((r) => r.action === 'error').length,
    };
    if (!input.commit) return { committed: false, rows: results, summary };
    if (summary.error) throw badRequest(`Fix the ${summary.error} row(s) with errors first`);
    if (!plans.length) throw badRequest('There is nothing to import');

    const approvedBy =
      plans.some((p) => p.kind === 'update' && p.priceChanged) && !isAdminRole(actor.user.role)
        ? await this.approvals.require(
            actor,
            'PRICE_CHANGE',
            'Admin approval needed: the import changes prices',
          )
        : null;

    await this.prisma.$transaction(
      async (tx) => {
        const categoryId = await this.lookupCreator(tx, 'category');
        const brandId = await this.lookupCreator(tx, 'brand');
        const createdProducts = new Map<string, string>();

        for (const plan of plans) {
          const p = plan.p;
          if (plan.kind === 'update') {
            const before = await tx.productVariant.findUniqueOrThrow({
              where: { id: plan.variantId },
            });
            await tx.productVariant.update({
              where: { id: plan.variantId },
              data: {
                costPrice: p.cost,
                retailPrice: p.retail,
                wholesalePrice: p.wholesale,
                reorderLevel: p.reorder,
              },
            });
            if (plan.priceChanged) {
              await this.audit.log(
                {
                  action: 'PRICE_CHANGE',
                  userId: actor.user.id,
                  approvedById: approvedBy,
                  entityType: 'ProductVariant',
                  entityId: plan.variantId,
                  summary: `${plan.label}: prices changed by import`,
                  before: {
                    costPrice: before.costPrice,
                    retailPrice: before.retailPrice,
                    wholesalePrice: before.wholesalePrice,
                  },
                  after: { costPrice: p.cost, retailPrice: p.retail, wholesalePrice: p.wholesale },
                },
                tx,
              );
            }
            continue;
          }

          let productId =
            plan.kind === 'add-variant'
              ? plan.productId
              : createdProducts.get(p.name.toLowerCase());
          if (!productId) {
            const product = await tx.product.create({
              data: {
                name: p.name,
                categoryId: p.category ? await categoryId(p.category) : null,
                brandId: p.brand ? await brandId(p.brand) : null,
              },
            });
            productId = product.id;
            createdProducts.set(p.name.toLowerCase(), productId);
          }
          const sku = p.sku ?? (await this.products.nextSku(tx));
          const code = p.barcode ?? (await this.products.nextBarcode(tx));
          const stock = p.stock ?? 0;
          const variant = await tx.productVariant.create({
            data: {
              productId,
              sku,
              name: p.variant,
              costPrice: p.cost ?? 0,
              retailPrice: p.retail!,
              wholesalePrice: p.wholesale ?? p.retail!,
              reorderLevel: p.reorder ?? 2,
              stockQty: stock,
              barcodes: { create: { code } },
            },
          });
          if (stock > 0) {
            await tx.stockMovement.create({
              data: {
                variantId: variant.id,
                type: 'OPENING',
                qtyChange: stock,
                qtyAfter: stock,
                unitCost: p.cost ?? 0,
                refType: 'Product',
                refId: productId,
                note: 'Opening stock (import)',
                userId: actor.user.id,
              },
            });
          }
        }
        await this.audit.log(
          {
            action: 'PRODUCT_IMPORT',
            userId: actor.user.id,
            approvedById: approvedBy,
            summary: `Imported products: ${summary.create} new, ${summary.addVariant} new variants, ${summary.update} updated`,
            meta: summary,
          },
          tx,
        );
      },
      { timeout: 120_000 },
    );
    return { committed: true, rows: results, summary };
  }

  /** Finds a category/brand by name (any letter case) or creates it, remembering earlier answers. */
  private async lookupCreator(tx: Tx, kind: 'category' | 'brand') {
    const cache = new Map<string, string>();
    const rows =
      kind === 'category'
        ? await tx.category.findMany({ select: { id: true, name: true } })
        : await tx.brand.findMany({ select: { id: true, name: true } });
    for (const r of rows) cache.set(r.name.toLowerCase(), r.id);
    return async (name: string) => {
      const key = name.toLowerCase();
      const known = cache.get(key);
      if (known) return known;
      const created =
        kind === 'category'
          ? await tx.category.create({ data: { name } })
          : await tx.brand.create({ data: { name } });
      cache.set(key, created.id);
      return created.id;
    };
  }
}
