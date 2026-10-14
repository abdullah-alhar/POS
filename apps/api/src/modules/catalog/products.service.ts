import { Injectable } from '@nestjs/common';
import {
  formatMoney,
  makeInternalEan13,
  normalizeBarcode,
  type Page,
  type ProductDto,
  type ProductInputParsed,
  type ProductListItem,
  type ProductQuery,
  type VariantDto,
  type VariantPricesInput,
} from '@marina/shared';
import { badRequest, conflict, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { nextCounter } from '../../prisma/counters';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';

type VariantInputParsed = ProductInputParsed['variants'][number];

const productInclude = {
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  taxRate: true,
  variants: {
    orderBy: { createdAt: 'asc' },
    include: { barcodes: { orderBy: { createdAt: 'asc' } } },
  },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type VariantWithBarcodes = ProductWithRelations['variants'][number];

const PRICE_FIELDS = ['costPrice', 'retailPrice', 'wholesalePrice'] as const;
const PRICE_LABELS: Record<(typeof PRICE_FIELDS)[number], string> = {
  costPrice: 'cost',
  retailPrice: 'retail price',
  wholesalePrice: 'wholesale price',
};

export function toVariantDto(v: VariantWithBarcodes): VariantDto {
  return {
    id: v.id,
    productId: v.productId,
    sku: v.sku,
    name: v.name,
    attributes: (v.attributes ?? {}) as Record<string, string>,
    barcodes: v.barcodes.map((b) => b.code),
    costPrice: v.costPrice,
    retailPrice: v.retailPrice,
    wholesalePrice: v.wholesalePrice,
    stockQty: v.stockQty,
    reorderLevel: v.reorderLevel,
    isActive: v.isActive,
  };
}

export function toProductDto(p: ProductWithRelations): ProductDto {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    categoryId: p.categoryId,
    brandId: p.brandId,
    taxRateId: p.taxRateId,
    category: p.category,
    brand: p.brand,
    taxRate: p.taxRate
      ? {
          id: p.taxRate.id,
          name: p.taxRate.name,
          rateBp: p.taxRate.rateBp,
          isDefault: p.taxRate.isDefault,
        }
      : null,
    trackStock: p.trackStock,
    warrantyDays: p.warrantyDays,
    trackSerial: p.trackSerial,
    isActive: p.isActive,
    variants: p.variants.map(toVariantDto),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function variantLabel(productName: string, variantName: string) {
  return variantName ? `${productName} – ${variantName}` : productName;
}

interface PriceChange {
  variantId: string;
  label: string;
  field: (typeof PRICE_FIELDS)[number];
  from: number;
  to: number;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  // ───────────── Reading ─────────────

  async list(query: ProductQuery): Promise<Page<ProductListItem>> {
    const where: Prisma.ProductWhereInput = {
      categoryId: query.categoryId,
      brandId: query.brandId,
      isActive: query.status === 'all' ? undefined : query.status === 'active',
    };
    const and: Prisma.ProductWhereInput[] = [];

    if (query.q) {
      const words = query.q.split(/\s+/).filter(Boolean);
      const code = normalizeBarcode(query.q);
      and.push({
        OR: [
          // Every word must match the name, brand or a variant name ("anker 20w").
          {
            AND: words.map((w) => ({
              OR: [
                { name: { contains: w, mode: 'insensitive' } },
                { brand: { name: { contains: w, mode: 'insensitive' } } },
                { variants: { some: { name: { contains: w, mode: 'insensitive' } } } },
              ],
            })),
          },
          { variants: { some: { sku: { contains: code.toUpperCase() } } } },
          { variants: { some: { barcodes: { some: { code } } } } },
        ],
      });
    }

    if (query.lowStock) {
      and.push({
        trackStock: true,
        variants: {
          some: {
            isActive: true,
            stockQty: { lte: this.prisma.productVariant.fields.reorderLevel },
          },
        },
      });
    }
    if (and.length) where.AND = and;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: query.sort === 'updated' ? { updatedAt: 'desc' } : { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          category: { select: { name: true } },
          brand: { select: { name: true } },
          variants: {
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
            include: { barcodes: { take: 1, orderBy: { createdAt: 'asc' } } },
          },
        },
      }),
    ]);

    const items: ProductListItem[] = rows.map((p) => {
      const prices = p.variants.map((v) => v.retailPrice);
      return {
        id: p.id,
        name: p.name,
        category: p.category?.name ?? null,
        brand: p.brand?.name ?? null,
        isActive: p.isActive,
        trackStock: p.trackStock,
        variantCount: p.variants.length,
        totalStock: p.variants.reduce((s, v) => s + v.stockQty, 0),
        lowStockVariants: p.trackStock
          ? p.variants.filter((v) => v.stockQty <= v.reorderLevel).length
          : 0,
        minRetailPrice: prices.length ? Math.min(...prices) : 0,
        maxRetailPrice: prices.length ? Math.max(...prices) : 0,
        firstBarcode: p.variants.find((v) => v.barcodes.length)?.barcodes[0]?.code ?? null,
        firstSku: p.variants[0]?.sku ?? '',
        updatedAt: p.updatedAt.toISOString(),
      };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) throw notFound('Product');
    return toProductDto(product);
  }

  // ───────────── Creating ─────────────

  async create(input: ProductInputParsed, actor: Actor): Promise<ProductDto> {
    await this.assertReferences(input);
    const id = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId,
          brandId: input.brandId,
          taxRateId: input.taxRateId,
          trackStock: input.trackStock,
          warrantyDays: input.warrantyDays,
          trackSerial: input.trackSerial,
          isActive: input.isActive,
        },
      });
      for (const v of input.variants) {
        await this.createVariant(tx, product.id, product.name, input.trackStock, v, actor);
      }
      await this.audit.log(
        {
          action: 'PRODUCT_CREATE',
          userId: actor.user.id,
          entityType: 'Product',
          entityId: product.id,
          summary: `Added product ${product.name} (${input.variants.length} variant(s))`,
          after: input,
        },
        tx,
      );
      return product.id;
    });
    return this.get(id);
  }

  private async createVariant(
    tx: Tx,
    productId: string,
    productName: string,
    trackStock: boolean,
    v: VariantInputParsed,
    actor: Actor,
  ) {
    const sku = v.sku ?? (await this.nextSku(tx));
    await this.assertSkuFree(tx, sku, null);
    const barcodes = v.barcodes.map(normalizeBarcode);
    if (v.generateBarcode && barcodes.length === 0) barcodes.push(await this.nextBarcode(tx));
    await this.assertBarcodesFree(tx, barcodes, null);

    const stock = trackStock ? v.openingStock : 0;
    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku,
        name: v.name,
        attributes: v.attributes,
        costPrice: v.costPrice,
        retailPrice: v.retailPrice,
        wholesalePrice: v.wholesalePrice,
        reorderLevel: v.reorderLevel,
        isActive: v.isActive,
        stockQty: stock,
        barcodes: { create: barcodes.map((code) => ({ code })) },
      },
    });
    if (stock > 0) {
      await tx.stockMovement.create({
        data: {
          variantId: variant.id,
          type: 'OPENING',
          qtyChange: stock,
          qtyAfter: stock,
          unitCost: v.costPrice,
          refType: 'Product',
          refId: productId,
          note: `Opening stock for ${variantLabel(productName, v.name)}`,
          userId: actor.user.id,
        },
      });
    }
    return variant;
  }

  // ───────────── Updating ─────────────

  async update(id: string, input: ProductInputParsed, actor: Actor): Promise<ProductDto> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!existing) throw notFound('Product');
    await this.assertReferences(input);

    const byId = new Map(existing.variants.map((v) => [v.id, v]));
    for (const v of input.variants) {
      if (v.id && !byId.has(v.id)) throw badRequest('A variant does not belong to this product');
    }

    const changes = input.variants.flatMap((v) =>
      v.id ? this.priceChanges(existing.name, byId.get(v.id)!, v) : [],
    );
    const approvedById = changes.length
      ? await this.approvals.require(
          actor,
          'PRICE_CHANGE',
          'Admin approval needed to change prices',
        )
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId,
          brandId: input.brandId,
          taxRateId: input.taxRateId,
          trackStock: input.trackStock,
          warrantyDays: input.warrantyDays,
          trackSerial: input.trackSerial,
          isActive: input.isActive,
        },
      });

      // Free barcodes first, so a code can move between variants of this product.
      // Hidden (removed) variants keep their barcodes unless another variant takes them.
      const allWanted = new Set(input.variants.flatMap((v) => v.barcodes.map(normalizeBarcode)));
      const inputById = new Map(input.variants.filter((v) => v.id).map((v) => [v.id!, v]));
      for (const current of existing.variants) {
        const kept = inputById.get(current.id);
        const wanted = kept ? kept.barcodes.map(normalizeBarcode) : [];
        const drop = current.barcodes
          .map((b) => b.code)
          .filter((c) => (kept ? !wanted.includes(c) : allWanted.has(c)));
        if (drop.length) {
          await tx.barcode.deleteMany({ where: { variantId: current.id, code: { in: drop } } });
        }
      }

      const keptIds = new Set<string>();
      for (const v of input.variants) {
        if (!v.id) {
          await this.createVariant(tx, id, input.name, input.trackStock, v, actor);
          continue;
        }
        keptIds.add(v.id);
        const current = byId.get(v.id)!;
        const sku = v.sku ?? current.sku;
        if (sku !== current.sku) await this.assertSkuFree(tx, sku, v.id);

        const wanted = v.barcodes.map(normalizeBarcode);
        if (v.generateBarcode && wanted.length === 0) wanted.push(await this.nextBarcode(tx));
        await this.assertBarcodesFree(tx, wanted, v.id);
        const have = current.barcodes.map((b) => b.code);

        await tx.productVariant.update({
          where: { id: v.id },
          data: {
            sku,
            name: v.name,
            attributes: v.attributes,
            costPrice: v.costPrice,
            retailPrice: v.retailPrice,
            wholesalePrice: v.wholesalePrice,
            reorderLevel: v.reorderLevel,
            isActive: v.isActive,
            barcodes: { create: wanted.filter((c) => !have.includes(c)).map((code) => ({ code })) },
          },
        });
      }

      // Variants left out of the form are hidden, never deleted: old bills still point to them.
      const removed = existing.variants.filter((v) => !keptIds.has(v.id) && v.isActive);
      if (removed.length) {
        await tx.productVariant.updateMany({
          where: { id: { in: removed.map((v) => v.id) } },
          data: { isActive: false },
        });
      }

      await this.audit.log(
        {
          action: 'PRODUCT_UPDATE',
          userId: actor.user.id,
          entityType: 'Product',
          entityId: id,
          summary: `Changed product ${input.name}`,
          before: toProductDto(existing),
          after: input,
        },
        tx,
      );
      await this.logPriceChanges(tx, changes, actor, approvedById);
    });

    return this.get(id);
  }

  async updatePrices(
    variantId: string,
    input: VariantPricesInput,
    actor: Actor,
  ): Promise<VariantDto> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true, barcodes: true },
    });
    if (!variant) throw notFound('Variant');
    const next = {
      costPrice: input.costPrice ?? variant.costPrice,
      retailPrice: input.retailPrice ?? variant.retailPrice,
      wholesalePrice: input.wholesalePrice ?? variant.wholesalePrice,
    };
    const changes = this.priceChanges(variant.product.name, variant, next);
    if (!changes.length) return toVariantDto(variant);

    const approvedById = await this.approvals.require(
      actor,
      'PRICE_CHANGE',
      'Admin approval needed to change prices',
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.productVariant.update({
        where: { id: variantId },
        data: next,
        include: { barcodes: true },
      });
      await this.logPriceChanges(tx, changes, actor, approvedById);
      return row;
    });
    return toVariantDto(updated);
  }

  private priceChanges(
    productName: string,
    current: { id: string; name: string } & Record<(typeof PRICE_FIELDS)[number], number>,
    next: Record<(typeof PRICE_FIELDS)[number], number>,
  ): PriceChange[] {
    return PRICE_FIELDS.filter((f) => current[f] !== next[f]).map((field) => ({
      variantId: current.id,
      label: variantLabel(productName, current.name),
      field,
      from: current[field],
      to: next[field],
    }));
  }

  private async logPriceChanges(
    tx: Tx,
    changes: PriceChange[],
    actor: Actor,
    approvedById: string | null,
  ) {
    for (const c of changes) {
      await this.audit.log(
        {
          action: 'PRICE_CHANGE',
          userId: actor.user.id,
          approvedById,
          entityType: 'ProductVariant',
          entityId: c.variantId,
          summary: `${c.label}: ${PRICE_LABELS[c.field]} ${formatMoney(c.from, { showCents: true })} → ${formatMoney(c.to, { showCents: true })}`,
          before: { [c.field]: c.from },
          after: { [c.field]: c.to },
        },
        tx,
      );
    }
  }

  // ───────────── Codes ─────────────

  /** New in-store EAN-13 barcodes (not yet attached to anything). */
  async generateBarcodes(count: number): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const codes: string[] = [];
      for (let i = 0; i < count; i++) codes.push(await this.nextBarcode(tx));
      return codes;
    });
  }

  async nextSku(tx: Tx): Promise<string> {
    for (;;) {
      const sku = `P${String(await nextCounter(tx, 'SKU')).padStart(6, '0')}`;
      if (!(await tx.productVariant.findUnique({ where: { sku } }))) return sku;
    }
  }

  async nextBarcode(tx: Tx): Promise<string> {
    for (;;) {
      const code = makeInternalEan13(await nextCounter(tx, 'BARCODE'));
      if (!(await tx.barcode.findUnique({ where: { code } }))) return code;
    }
  }

  private async assertSkuFree(tx: Tx, sku: string, ownVariantId: string | null) {
    const clash = await tx.productVariant.findUnique({
      where: { sku },
      include: { product: true },
    });
    if (clash && clash.id !== ownVariantId) {
      throw conflict(
        `SKU ${sku} is already used by "${variantLabel(clash.product.name, clash.name)}"`,
      );
    }
  }

  private async assertBarcodesFree(tx: Tx, codes: string[], ownVariantId: string | null) {
    if (!codes.length) return;
    const clashes = await tx.barcode.findMany({
      where: { code: { in: codes }, variantId: ownVariantId ? { not: ownVariantId } : undefined },
      include: { variant: { include: { product: true } } },
    });
    const first = clashes[0];
    if (first) {
      throw conflict(
        `Barcode ${first.code} is already used by "${variantLabel(first.variant.product.name, first.variant.name)}"`,
      );
    }
  }

  private async assertReferences(input: ProductInputParsed) {
    const [category, brand, taxRate] = await Promise.all([
      input.categoryId
        ? this.prisma.category.findUnique({ where: { id: input.categoryId } })
        : true,
      input.brandId ? this.prisma.brand.findUnique({ where: { id: input.brandId } }) : true,
      input.taxRateId ? this.prisma.taxRate.findUnique({ where: { id: input.taxRateId } }) : true,
    ]);
    if (!category) throw notFound('Category');
    if (!brand) throw notFound('Brand');
    if (!taxRate) throw notFound('Tax rate');
  }
}
