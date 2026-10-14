import { Injectable } from '@nestjs/common';
import {
  formatMoney,
  PAYMENT_METHOD_LABELS,
  type SupplierDto,
  type SupplierInput,
  type SupplierPaymentInput,
} from '@marina/shared';
import { badRequest, conflict, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Suppliers with what the shop still owes them (received purchases minus payments). */
  async list(): Promise<SupplierDto[]> {
    const [suppliers, owed, paid] = await Promise.all([
      this.prisma.supplier.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { purchases: true } } },
      }),
      this.prisma.purchase.groupBy({
        by: ['supplierId'],
        where: { status: 'RECEIVED' },
        _sum: { total: true },
      }),
      this.prisma.supplierPayment.groupBy({ by: ['supplierId'], _sum: { amount: true } }),
    ]);
    const owedBy = new Map(owed.map((o) => [o.supplierId, o._sum.total ?? 0]));
    const paidBy = new Map(paid.map((p) => [p.supplierId, p._sum.amount ?? 0]));
    return suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      contactName: s.contactName,
      phone: s.phone,
      email: s.email,
      address: s.address,
      notes: s.notes,
      isActive: s.isActive,
      balance: (owedBy.get(s.id) ?? 0) - (paidBy.get(s.id) ?? 0),
      purchaseCount: s._count.purchases,
    }));
  }

  async save(id: string | null, input: SupplierInput, actor: Actor) {
    const data = {
      name: input.name,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      isActive: input.isActive ?? true,
    };
    const clash = await this.prisma.supplier.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, id: id ? { not: id } : undefined },
    });
    if (clash)
      throw conflict(`A supplier called "${clash.name}" already exists`, {
        name: 'Already exists',
      });
    const row = id
      ? await this.prisma.supplier.update({ where: { id }, data })
      : await this.prisma.supplier.create({ data });
    await this.audit.log({
      action: id ? 'SUPPLIER_UPDATE' : 'SUPPLIER_CREATE',
      userId: actor.user.id,
      entityType: 'Supplier',
      entityId: row.id,
      summary: `${id ? 'Changed' : 'Added'} supplier ${row.name}`,
    });
    return row;
  }

  /** Money paid to a supplier (optionally against one purchase). */
  async pay(supplierId: string, input: SupplierPaymentInput, actor: Actor) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw notFound('Supplier');
    return this.prisma.$transaction(async (tx) => {
      if (input.purchaseId) {
        const purchase = await tx.purchase.findUnique({ where: { id: input.purchaseId } });
        if (!purchase || purchase.supplierId !== supplierId) throw notFound('Purchase');
        if (purchase.status !== 'RECEIVED') throw badRequest('Only received purchases can be paid');
        if (purchase.paidAmount + input.amount > purchase.total) {
          throw badRequest(
            `Only ${formatMoney(purchase.total - purchase.paidAmount, { showCents: true })} is still due on ${purchase.number}`,
          );
        }
        await tx.purchase.update({
          where: { id: purchase.id },
          data: { paidAmount: { increment: input.amount } },
        });
      }
      const payment = await tx.supplierPayment.create({
        data: {
          supplierId,
          purchaseId: input.purchaseId ?? null,
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          note: input.note ?? null,
          userId: actor.user.id,
        },
      });
      await this.audit.log(
        {
          action: 'SUPPLIER_PAYMENT',
          userId: actor.user.id,
          entityType: 'Supplier',
          entityId: supplierId,
          summary: `Paid ${supplier.name} ${formatMoney(input.amount, { showCents: true })} (${PAYMENT_METHOD_LABELS[input.method]})`,
        },
        tx,
      );
      return payment;
    });
  }

  async payments(supplierId: string) {
    return this.prisma.supplierPayment.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      include: { purchase: { select: { number: true } }, user: { select: { fullName: true } } },
    });
  }
}
