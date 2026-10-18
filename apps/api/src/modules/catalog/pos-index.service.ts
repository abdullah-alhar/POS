import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { normalizeBarcode, type PosIndex, type PosIndexItem } from '@shoppos/shared';
import { notFound } from '../../common/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import { variantLabel } from './products.service';

/**
 * The billing screen keeps every sellable variant in memory so a barcode scan is a local lookup
 * (well under 100 ms) instead of a network call. This builds that list.
 */
@Injectable()
export class PosIndexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async build(): Promise<PosIndex> {
    const items = await this.items({ isActive: true, product: { isActive: true } });
    const version = createHash('sha1').update(JSON.stringify(items)).digest('hex').slice(0, 16);
    return { version, items };
  }

  /** Find one variant by barcode or SKU, including inactive ones (so the cashier gets a clear message). */
  async lookup(code: string): Promise<PosIndexItem & { isActive: boolean }> {
    const clean = normalizeBarcode(code);
    const barcode = await this.prisma.barcode.findUnique({ where: { code: clean } });
    const where = barcode ? { id: barcode.variantId } : { sku: clean.toUpperCase() };
    const variant = await this.prisma.productVariant.findFirst({
      where,
      include: { product: true },
    });
    if (!variant) throw notFound(`Item with code ${clean}`);
    const [item] = await this.items({ id: variant.id });
    return { ...item!, isActive: variant.isActive && variant.product.isActive };
  }

  private async items(where: Prisma.ProductVariantWhereInput): Promise<PosIndexItem[]> {
    const [variants, defaultRate] = await Promise.all([
      this.prisma.productVariant.findMany({
        where,
        orderBy: [{ product: { name: 'asc' } }, { createdAt: 'asc' }],
        include: {
          barcodes: { select: { code: true }, orderBy: { createdAt: 'asc' } },
          product: {
            include: {
              taxRate: true,
              category: { select: { name: true } },
              brand: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.taxRate.findFirst({ where: { isDefault: true } }),
    ]);
    const vatOn = this.settings.get('tax').vatRegistered;

    return variants.map((v) => ({
      variantId: v.id,
      productId: v.productId,
      name: variantLabel(v.product.name, v.name),
      sku: v.sku,
      barcodes: v.barcodes.map((b) => b.code),
      retailPrice: v.retailPrice,
      wholesalePrice: v.wholesalePrice,
      stockQty: v.stockQty,
      trackStock: v.product.trackStock,
      taxRateBp: vatOn ? (v.product.taxRate?.rateBp ?? defaultRate?.rateBp ?? 0) : 0,
      category: v.product.category?.name ?? null,
      brand: v.product.brand?.name ?? null,
      warrantyDays: v.product.warrantyDays,
      trackSerial: v.product.trackSerial,
    }));
  }
}
