import { HttpStatus, Injectable } from '@nestjs/common';
import {
  formatMoney,
  type CashMovementInput,
  type CashSessionDto,
  type CashSessionSummary,
  type CloseDayInput,
  type OpenCashSessionInput,
  type Page,
} from '@shoppos/shared';
import { AppException, badRequest, conflict, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { CashSession, Prisma, User } from '../../generated/prisma/client';
import { openDayIfNeeded } from './auto-open';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';

export function toCashSessionDto(
  s: CashSession & { openedBy: Pick<User, 'id' | 'fullName'> },
): CashSessionDto {
  return {
    id: s.id,
    status: s.status,
    openedAt: s.openedAt.toISOString(),
    openedBy: { id: s.openedBy.id, fullName: s.openedBy.fullName },
    openingCash: s.openingCash,
  };
}

const notOpen = () =>
  new AppException(
    HttpStatus.CONFLICT,
    'DAY_NOT_OPEN',
    'There is no day to close yet: the day starts by itself with the first sale.',
  );

/** Listeners called after a day is closed (the backup service starts a backup). */
type CloseListener = (sessionId: string) => void;

/**
 * The cash register "day": open with the cash in the drawer, record cash in/out during the day,
 * and close by counting the cash. The report shows what should be in the drawer.
 */
@Injectable()
export class CashRegisterService {
  private readonly closeListeners: CloseListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  onDayClosed(listener: CloseListener) {
    this.closeListeners.push(listener);
  }

  async current(): Promise<CashSessionDto | null> {
    const session = await this.prisma.cashSession.findFirst({
      where: { status: 'OPEN' },
      include: { openedBy: { select: { id: true, fullName: true } } },
    });
    return session ? toCashSessionDto(session) : null;
  }

  /** The open session inside a transaction, or an error the till understands. */
  async requireOpen(tx: Tx): Promise<CashSession> {
    const session = await tx.cashSession.findFirst({ where: { status: 'OPEN' } });
    if (!session) throw notOpen();
    return session;
  }

  async open(input: OpenCashSessionInput, actor: Actor): Promise<CashSessionDto> {
    return this.prisma.$transaction(async (tx) => {
      // Only one person can open the day at a time.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4201)`;
      if (await tx.cashSession.findFirst({ where: { status: 'OPEN' } })) {
        throw conflict('The day is already open');
      }
      const session = await tx.cashSession.create({
        data: { openingCash: input.openingCash, openedById: actor.user.id },
        include: { openedBy: { select: { id: true, fullName: true } } },
      });
      await this.audit.log(
        {
          action: 'DAY_OPEN',
          userId: actor.user.id,
          entityType: 'CashSession',
          entityId: session.id,
          summary: `Opened the day with ${formatMoney(input.openingCash, { showCents: true })} in the drawer`,
        },
        tx,
      );
      return toCashSessionDto(session);
    });
  }

  /**
   * The cash that was in the drawer when the day started (the day opens by itself at the first
   * sale, with 0). Can be set while the day is open; written in the audit log.
   */
  async setOpeningCash(openingCash: number, actor: Actor): Promise<CashSessionDto> {
    return this.prisma.$transaction(async (tx) => {
      const session = await openDayIfNeeded(tx, actor.user.id);
      const updated = await tx.cashSession.update({
        where: { id: session.id },
        data: { openingCash },
        include: { openedBy: { select: { id: true, fullName: true } } },
      });
      await this.audit.log(
        {
          action: 'DAY_OPEN',
          userId: actor.user.id,
          entityType: 'CashSession',
          entityId: session.id,
          summary: `Opening cash set to ${formatMoney(openingCash, { showCents: true })} (was ${formatMoney(session.openingCash, { showCents: true })})`,
        },
        tx,
      );
      return toCashSessionDto(updated);
    });
  }

  /** All the numbers for one day; used live (open day) and for the end-of-day report. */
  async summary(
    sessionId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<CashSessionSummary> {
    const s = await db.cashSession.findUnique({
      where: { id: sessionId },
      include: {
        openedBy: { select: { id: true, fullName: true } },
        closedBy: { select: { id: true, fullName: true } },
        movements: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { fullName: true } } },
        },
      },
    });
    if (!s) throw notFound('Day');

    const [payments, sales, voids, refunds, customerCash, expenses] = await Promise.all([
      db.payment.groupBy({
        by: ['method'],
        where: { sale: { cashSessionId: sessionId, status: 'COMPLETED' } },
        _sum: { amount: true },
      }),
      db.sale.aggregate({
        where: { cashSessionId: sessionId, status: 'COMPLETED' },
        _sum: { total: true },
        _count: true,
      }),
      db.sale.count({ where: { cashSessionId: sessionId, status: 'VOIDED' } }),
      db.saleReturn.groupBy({
        by: ['refundMethod'],
        where: { cashSessionId: sessionId },
        _sum: { total: true },
        _count: true,
      }),
      db.customerLedger.aggregate({
        where: { cashSessionId: sessionId, type: 'PAYMENT', method: 'CASH' },
        _sum: { amount: true },
      }),
      db.expense.aggregate({
        where: { cashSessionId: sessionId, paidFrom: 'DRAWER', cancelledAt: null },
        _sum: { amount: true },
      }),
    ]);
    const paid = (m: string) => payments.find((p) => p.method === m)?._sum.amount ?? 0;
    const cashRefunds = refunds.find((r) => r.refundMethod === 'CASH')?._sum.total ?? 0;
    const otherRefunds = refunds
      .filter((r) => r.refundMethod !== 'CASH')
      .reduce((n, r) => n + (r._sum.total ?? 0), 0);
    const cashIn = s.movements
      .filter((m) => m.type === 'CASH_IN')
      .reduce((n, m) => n + m.amount, 0);
    const cashOut = s.movements
      .filter((m) => m.type === 'CASH_OUT')
      .reduce((n, m) => n + m.amount, 0);
    const customerCashPayments = -(customerCash._sum.amount ?? 0);
    const drawerExpenses = expenses._sum.amount ?? 0;
    const cashSales = paid('CASH');
    const expected =
      s.status === 'CLOSED' && s.expectedCash !== null
        ? s.expectedCash
        : s.openingCash +
          cashSales +
          customerCashPayments +
          cashIn -
          cashOut -
          cashRefunds -
          drawerExpenses;

    return {
      id: s.id,
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      openedBy: s.openedBy,
      closedAt: s.closedAt?.toISOString() ?? null,
      closedBy: s.closedBy,
      openingCash: s.openingCash,
      cashSales,
      cardSales: paid('CARD'),
      bankSales: paid('BANK_TRANSFER'),
      creditSales: paid('CREDIT'),
      customerCashPayments,
      cashIn,
      cashOut,
      cashRefunds,
      otherRefunds,
      drawerExpenses,
      expectedCash: expected,
      countedCash: s.countedCash,
      difference: s.difference,
      denominations: (s.denominations as Record<string, number> | null) ?? null,
      note: s.note,
      billCount: sales._count,
      voidCount: voids,
      returnCount: refunds.reduce((n, r) => n + r._count, 0),
      totalSales: sales._sum.total ?? 0,
      movements: s.movements.map((m) => ({
        id: m.id,
        type: m.type,
        amount: m.amount,
        reason: m.reason,
        createdAt: m.createdAt.toISOString(),
        userName: m.user.fullName,
      })),
    };
  }

  async currentSummary(): Promise<CashSessionSummary | null> {
    const session = await this.prisma.cashSession.findFirst({ where: { status: 'OPEN' } });
    return session ? this.summary(session.id) : null;
  }

  /** Cash put into or taken out of the drawer without a sale. Taking cash out needs an admin PIN for a cashier. */
  async movement(input: CashMovementInput, actor: Actor): Promise<CashSessionSummary> {
    const approvedBy =
      input.type === 'CASH_OUT'
        ? await this.approvals.require(
            actor,
            'CASH_OUT',
            'Admin approval needed to take cash out of the drawer',
          )
        : null;
    const sessionId = await this.prisma.$transaction(async (tx) => {
      const session = await openDayIfNeeded(tx, actor.user.id);
      await tx.cashMovement.create({
        data: {
          sessionId: session.id,
          type: input.type,
          amount: input.amount,
          reason: input.reason,
          userId: actor.user.id,
          approvedById: approvedBy,
        },
      });
      await this.audit.log(
        {
          action: input.type,
          userId: actor.user.id,
          approvedById: approvedBy,
          entityType: 'CashSession',
          entityId: session.id,
          summary: `${input.type === 'CASH_IN' ? 'Put' : 'Took'} ${formatMoney(input.amount, { showCents: true })} ${input.type === 'CASH_IN' ? 'into' : 'out of'} the drawer: ${input.reason}`,
        },
        tx,
      );
      return session.id;
    });
    return this.summary(sessionId);
  }

  /** End of day: the counted cash is compared with what should be in the drawer. */
  async close(input: CloseDayInput, actor: Actor): Promise<CashSessionSummary> {
    if (input.denominations) {
      const fromNotes = Object.entries(input.denominations).reduce(
        (n, [value, count]) => n + Number(value) * 100 * count,
        0,
      );
      if (fromNotes !== input.countedCash)
        throw badRequest('The counted notes and coins do not add up to the counted cash');
    }
    const sessionId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4201)`;
      const session = await this.requireOpen(tx);
      const summary = await this.summary(session.id, tx);
      const difference = input.countedCash - summary.expectedCash;
      await tx.cashSession.update({
        where: { id: session.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: actor.user.id,
          expectedCash: summary.expectedCash,
          countedCash: input.countedCash,
          difference,
          denominations: (input.denominations ?? undefined) as Prisma.InputJsonValue | undefined,
          note: input.note ?? null,
        },
      });
      await this.audit.log(
        {
          action: 'DAY_CLOSE',
          userId: actor.user.id,
          entityType: 'CashSession',
          entityId: session.id,
          summary: `Closed the day: expected ${formatMoney(summary.expectedCash, { showCents: true })}, counted ${formatMoney(input.countedCash, { showCents: true })} (${difference === 0 ? 'exact' : difference > 0 ? `over ${formatMoney(difference, { showCents: true })}` : `short ${formatMoney(-difference, { showCents: true })}`})`,
        },
        tx,
      );
      return session.id;
    });
    for (const listener of this.closeListeners) listener(sessionId);
    return this.summary(sessionId);
  }

  async list(page = 1, pageSize = 30): Promise<Page<CashSessionSummary>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.cashSession.count(),
      this.prisma.cashSession.findMany({
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true },
      }),
    ]);
    return { items: await Promise.all(rows.map((r) => this.summary(r.id))), total, page, pageSize };
  }
}
