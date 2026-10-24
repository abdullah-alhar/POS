import { Injectable } from '@nestjs/common';
import {
  EXPENSE_CATEGORIES,
  formatMoney,
  type ExpenseDto,
  type ExpenseInput,
  type ExpenseQuery,
  type Page,
} from '@shoppos/shared';
import { openDayIfNeeded } from '../cash-register/auto-open';
import { conflict, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { nextDocumentNumber } from '../../prisma/counters';
import { PrismaService } from '../../prisma/prisma.service';
import type { Expense, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';

function toDto(e: Expense & { user: { fullName: string } }): ExpenseDto {
  return {
    id: e.id,
    number: e.number,
    date: e.date.toISOString().slice(0, 10),
    category: e.category,
    amount: e.amount,
    paidFrom: e.paidFrom,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
    userName: e.user.fullName,
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
    cancelReason: e.cancelReason,
  };
}

const utcDate = (d: string) => new Date(`${d}T00:00:00Z`);

/** Shop expenses. Cash taken from the drawer is counted in that day's cash. */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ExpenseQuery): Promise<Page<ExpenseDto> & { totalAmount: number }> {
    const where: Prisma.ExpenseWhereInput = {
      category: query.category || undefined,
      date:
        query.from || query.to
          ? {
              gte: query.from ? utcDate(query.from) : undefined,
              lte: query.to ? utcDate(query.to) : undefined,
            }
          : undefined,
    };
    const [total, rows, sum] = await this.prisma.$transaction([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { fullName: true } } },
      }),
      this.prisma.expense.aggregate({
        where: { ...where, cancelledAt: null },
        _sum: { amount: true },
      }),
    ]);
    return {
      items: rows.map(toDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalAmount: sum._sum.amount ?? 0,
    };
  }

  /** The standard categories plus any the shop has used before. */
  async categories(): Promise<string[]> {
    const used = await this.prisma.expense.findMany({
      distinct: ['category'],
      select: { category: true },
    });
    return [...new Set([...EXPENSE_CATEGORIES, ...used.map((u) => u.category)])];
  }

  async create(input: ExpenseInput, actor: Actor): Promise<ExpenseDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const session =
        input.paidFrom === 'DRAWER'
          ? await openDayIfNeeded(tx, actor.user.id)
          : await tx.cashSession.findFirst({ where: { status: 'OPEN' } });
      const number = await nextDocumentNumber(tx, 'EXP');
      const expense = await tx.expense.create({
        data: {
          number,
          date: utcDate(input.date),
          category: input.category,
          amount: input.amount,
          paidFrom: input.paidFrom,
          note: input.note ?? null,
          cashSessionId: input.paidFrom === 'DRAWER' ? session!.id : null,
          userId: actor.user.id,
        },
        include: { user: { select: { fullName: true } } },
      });
      await this.audit.log(
        {
          action: 'EXPENSE_CREATE',
          userId: actor.user.id,
          entityType: 'Expense',
          entityId: expense.id,
          summary: `${number}: ${input.category} ${formatMoney(input.amount, { showCents: true })}`,
        },
        tx,
      );
      return expense;
    });
    return toDto(row);
  }

  async cancel(id: string, reason: string, actor: Actor): Promise<ExpenseDto> {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw notFound('Expense');
    if (expense.cancelledAt) throw conflict(`${expense.number} is already cancelled`);
    const row = await this.prisma.expense.update({
      where: { id },
      data: { cancelledAt: new Date(), cancelReason: reason },
      include: { user: { select: { fullName: true } } },
    });
    await this.audit.log({
      action: 'EXPENSE_CANCEL',
      userId: actor.user.id,
      entityType: 'Expense',
      entityId: id,
      summary: `Cancelled ${expense.number}: ${reason}`,
    });
    return toDto(row);
  }
}
