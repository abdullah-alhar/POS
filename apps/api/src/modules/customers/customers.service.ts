import { HttpStatus, Injectable } from '@nestjs/common';
import {
  formatMoney,
  PAYMENT_METHOD_LABELS,
  type CustomerAdjustInput,
  type CustomerDto,
  type CustomerInput,
  type CustomerLedgerEntryDto,
  type CustomerPaymentInput,
  type CustomerQuery,
  type Page,
  type SaleListItem,
} from '@shoppos/shared';
import { AppException, badRequest, conflict, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import type { Customer, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';

export function toCustomerDto(c: Customer): CustomerDto {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: c.address,
    type: c.type,
    creditLimit: c.creditLimit,
    balance: c.balance,
    notes: c.notes,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Phone numbers are compared without spaces or dashes. */
const cleanPhone = (p?: string | null) => (p ? p.replace(/[\s-]/g, '') : null);

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: CustomerQuery): Promise<Page<CustomerDto>> {
    const where: Prisma.CustomerWhereInput = {
      type: query.type,
      isActive: query.status === 'all' ? undefined : query.status === 'active',
      balance: query.owing ? { gt: 0 } : undefined,
    };
    if (query.q) {
      const phone = cleanPhone(query.q);
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        ...(phone ? [{ phone: { contains: phone } }] : []),
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: query.owing ? { balance: 'desc' } : { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toCustomerDto), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<CustomerDto> {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c) throw notFound('Customer');
    return toCustomerDto(c);
  }

  async save(id: string | null, input: CustomerInput, actor: Actor): Promise<CustomerDto> {
    const phone = cleanPhone(input.phone);
    if (phone) {
      const clash = await this.prisma.customer.findFirst({
        where: { phone, id: id ? { not: id } : undefined },
      });
      if (clash)
        throw conflict(`${clash.name} already has this phone number`, { phone: 'Already used' });
    }
    const data = {
      name: input.name,
      phone,
      email: input.email ?? null,
      address: input.address ?? null,
      type: input.type ?? 'RETAIL',
      creditLimit: input.creditLimit ?? 0,
      notes: input.notes ?? null,
      isActive: input.isActive ?? true,
    };
    const before = id ? await this.prisma.customer.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound('Customer');
    const row = id
      ? await this.prisma.customer.update({ where: { id }, data })
      : await this.prisma.customer.create({ data });
    await this.audit.log({
      action: id ? 'CUSTOMER_UPDATE' : 'CUSTOMER_CREATE',
      userId: actor.user.id,
      entityType: 'Customer',
      entityId: row.id,
      summary: `${id ? 'Changed' : 'Added'} customer ${row.name}`,
      before: before ? toCustomerDto(before) : undefined,
      after: toCustomerDto(row),
    });
    return toCustomerDto(row);
  }

  async ledger(id: string, page = 1, pageSize = 50): Promise<Page<CustomerLedgerEntryDto>> {
    const where = { customerId: id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customerLedger.count({ where }),
      this.prisma.customerLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { fullName: true } } },
      }),
    ]);
    return {
      items: rows.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        type: e.type,
        amount: e.amount,
        balanceAfter: e.balanceAfter,
        method: e.method,
        reference: e.reference,
        note: e.note,
        userName: e.user.fullName,
      })),
      total,
      page,
      pageSize,
    };
  }

  async sales(id: string): Promise<SaleListItem[]> {
    const rows = await this.prisma.sale.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        cashier: { select: { fullName: true } },
        items: { select: { qty: true } },
        payments: { select: { method: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      number: s.number,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      cashierName: s.cashier.fullName,
      customerName: null,
      itemCount: s.items.reduce((n, i) => n + i.qty, 0),
      total: s.total,
      methods: [...new Set(s.payments.map((p) => p.method))],
    }));
  }

  /** The customer pays off (part of) what they owe. Cash goes into today's drawer. */
  async receivePayment(
    id: string,
    input: CustomerPaymentInput,
    actor: Actor,
  ): Promise<CustomerDto> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw notFound('Customer');
      if (input.amount > customer.balance) {
        throw badRequest(
          `${customer.name} owes only ${formatMoney(customer.balance, { showCents: true })}`,
        );
      }
      const session = await tx.cashSession.findFirst({ where: { status: 'OPEN' } });
      if (input.method === 'CASH' && !session) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'DAY_NOT_OPEN',
          'Open the day before taking a cash payment.',
        );
      }
      const updated = await tx.customer.update({
        where: { id },
        data: { balance: { decrement: input.amount } },
      });
      await tx.customerLedger.create({
        data: {
          customerId: id,
          type: 'PAYMENT',
          amount: -input.amount,
          balanceAfter: updated.balance,
          method: input.method,
          reference: input.reference ?? null,
          note: input.note ?? null,
          userId: actor.user.id,
          cashSessionId: session?.id ?? null,
        },
      });
      await this.audit.log(
        {
          action: 'CUSTOMER_PAYMENT',
          userId: actor.user.id,
          entityType: 'Customer',
          entityId: id,
          summary: `${customer.name} paid ${formatMoney(input.amount, { showCents: true })} (${PAYMENT_METHOD_LABELS[input.method]})`,
        },
        tx,
      );
      return toCustomerDto(updated);
    });
  }

  /** Admin correction, e.g. a balance owed from before the POS. */
  async adjust(id: string, input: CustomerAdjustInput, actor: Actor): Promise<CustomerDto> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw notFound('Customer');
      const updated = await tx.customer.update({
        where: { id },
        data: { balance: { increment: input.amount } },
      });
      await tx.customerLedger.create({
        data: {
          customerId: id,
          type: 'ADJUSTMENT',
          amount: input.amount,
          balanceAfter: updated.balance,
          note: input.note,
          userId: actor.user.id,
        },
      });
      await this.audit.log(
        {
          action: 'CUSTOMER_ADJUST',
          userId: actor.user.id,
          entityType: 'Customer',
          entityId: id,
          summary: `${customer.name}: balance ${input.amount > 0 ? '+' : ''}${formatMoney(input.amount, { showCents: true })} (${input.note})`,
        },
        tx,
      );
      return toCustomerDto(updated);
    });
  }
}
