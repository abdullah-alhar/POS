import { Injectable } from '@nestjs/common';
import type {
  BrandDto,
  BrandInput,
  CategoryDto,
  CategoryInput,
  TaxRateDto,
  TaxRateInput,
} from '@marina/shared';
import { badRequest, conflict, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Categories, brands and tax rates: the small lists products point to. */
@Injectable()
export class LookupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Categories ──

  async categories(): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      productCount: c._count.products,
    }));
  }

  async createCategory(input: CategoryInput, actor: Actor) {
    await this.assertCategoryNameFree(input.name);
    if (input.parentId) await this.assertValidParent(input.parentId, null);
    const row = await this.prisma.category.create({ data: input });
    await this.log(actor, 'CATEGORY_CREATE', 'Category', row.id, `Added category ${row.name}`);
    return row;
  }

  async updateCategory(id: string, input: CategoryInput, actor: Actor) {
    const current = await this.prisma.category.findUnique({ where: { id } });
    if (!current) throw notFound('Category');
    await this.assertCategoryNameFree(input.name, id);
    if (input.parentId) await this.assertValidParent(input.parentId, id);
    const row = await this.prisma.category.update({ where: { id }, data: input });
    await this.log(
      actor,
      'CATEGORY_UPDATE',
      'Category',
      id,
      `Changed category ${current.name} → ${row.name}`,
    );
    return row;
  }

  async deleteCategory(id: string, actor: Actor) {
    const row = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!row) throw notFound('Category');
    if (row._count.products > 0)
      throw conflict(`"${row.name}" still has ${row._count.products} product(s)`);
    if (row._count.children > 0) throw conflict(`"${row.name}" still has sub-categories`);
    await this.prisma.category.delete({ where: { id } });
    await this.log(actor, 'CATEGORY_DELETE', 'Category', id, `Deleted category ${row.name}`);
  }

  private async assertCategoryNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        id: exceptId ? { not: exceptId } : undefined,
      },
    });
    if (clash)
      throw conflict(`A category called "${clash.name}" already exists`, {
        name: 'Already exists',
      });
  }

  /** Only one level of sub-categories, and no loops. */
  private async assertValidParent(parentId: string, selfId: string | null) {
    if (parentId === selfId) throw badRequest('A category cannot be inside itself');
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) throw notFound('Parent category');
    if (parent.parentId) throw badRequest('Sub-categories cannot have their own sub-categories');
    if (selfId && (await this.prisma.category.count({ where: { parentId: selfId } })) > 0) {
      throw badRequest('This category has sub-categories, so it cannot be moved inside another');
    }
  }

  // ── Brands ──

  async brands(): Promise<BrandDto[]> {
    const rows = await this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    return rows.map((b) => ({ id: b.id, name: b.name, productCount: b._count.products }));
  }

  async createBrand(input: BrandInput, actor: Actor) {
    await this.assertBrandNameFree(input.name);
    const row = await this.prisma.brand.create({ data: input });
    await this.log(actor, 'BRAND_CREATE', 'Brand', row.id, `Added brand ${row.name}`);
    return row;
  }

  async updateBrand(id: string, input: BrandInput, actor: Actor) {
    const current = await this.prisma.brand.findUnique({ where: { id } });
    if (!current) throw notFound('Brand');
    await this.assertBrandNameFree(input.name, id);
    const row = await this.prisma.brand.update({ where: { id }, data: input });
    await this.log(
      actor,
      'BRAND_UPDATE',
      'Brand',
      id,
      `Changed brand ${current.name} → ${row.name}`,
    );
    return row;
  }

  async deleteBrand(id: string, actor: Actor) {
    const row = await this.prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!row) throw notFound('Brand');
    if (row._count.products > 0)
      throw conflict(`"${row.name}" still has ${row._count.products} product(s)`);
    await this.prisma.brand.delete({ where: { id } });
    await this.log(actor, 'BRAND_DELETE', 'Brand', id, `Deleted brand ${row.name}`);
  }

  private async assertBrandNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.brand.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        id: exceptId ? { not: exceptId } : undefined,
      },
    });
    if (clash)
      throw conflict(`A brand called "${clash.name}" already exists`, { name: 'Already exists' });
  }

  // ── Tax rates ──

  async taxRates(): Promise<TaxRateDto[]> {
    const rows = await this.prisma.taxRate.findMany({ orderBy: { rateBp: 'asc' } });
    return rows.map(({ id, name, rateBp, isDefault }) => ({ id, name, rateBp, isDefault }));
  }

  async saveTaxRate(id: string | null, input: TaxRateInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.taxRate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      const row = id
        ? await tx.taxRate.update({ where: { id }, data: input })
        : await tx.taxRate.create({ data: input });
      await this.audit.log(
        {
          action: id ? 'TAX_RATE_UPDATE' : 'TAX_RATE_CREATE',
          userId: actor.user.id,
          entityType: 'TaxRate',
          entityId: row.id,
          summary: `${id ? 'Changed' : 'Added'} tax rate ${row.name} (${row.rateBp / 100}%)`,
          after: row,
        },
        tx,
      );
      return row;
    });
  }

  async deleteTaxRate(id: string, actor: Actor) {
    const row = await this.prisma.taxRate.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!row) throw notFound('Tax rate');
    if (row._count.products > 0)
      throw conflict(`"${row.name}" is used by ${row._count.products} product(s)`);
    if (row.isDefault) throw conflict('Choose another default tax rate before deleting this one');
    await this.prisma.taxRate.delete({ where: { id } });
    await this.log(actor, 'TAX_RATE_DELETE', 'TaxRate', id, `Deleted tax rate ${row.name}`);
  }

  private log(actor: Actor, action: string, entityType: string, entityId: string, summary: string) {
    return this.audit.log({ action, userId: actor.user.id, entityType, entityId, summary });
  }
}
