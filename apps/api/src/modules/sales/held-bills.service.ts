import { Injectable } from '@nestjs/common';
import type { HeldBillDto, HeldCart, HoldBillInput } from '@shoppos/shared';
import { notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import type { HeldBill, Prisma, User } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';

function toDto(h: HeldBill & { user: Pick<User, 'id' | 'fullName'> }): HeldBillDto {
  const cart = h.cart as unknown as HeldCart;
  return {
    id: h.id,
    label: h.label,
    createdAt: h.createdAt.toISOString(),
    user: h.user,
    itemCount: cart.lines.reduce((n, l) => n + l.qty, 0),
    cart,
  };
}

/** Parked bills: the customer steps away, the cashier serves the next one, then recalls it. */
@Injectable()
export class HeldBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<HeldBillDto[]> {
    const rows = await this.prisma.heldBill.findMany({
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, fullName: true } } },
    });
    return rows.map(toDto);
  }

  async hold(input: HoldBillInput, actor: Actor): Promise<HeldBillDto> {
    const row = await this.prisma.heldBill.create({
      data: {
        label: input.label || null,
        cart: input.cart as unknown as Prisma.InputJsonValue,
        userId: actor.user.id,
      },
      include: { user: { select: { id: true, fullName: true } } },
    });
    await this.audit.log({
      action: 'BILL_HOLD',
      userId: actor.user.id,
      entityType: 'HeldBill',
      entityId: row.id,
      summary: `Held a bill with ${toDto(row).itemCount} item(s)${row.label ? ` (${row.label})` : ''}`,
    });
    return toDto(row);
  }

  /** Take a held bill back to the till. It is removed from the held list in the same step. */
  async recall(id: string, actor: Actor): Promise<HeldBillDto> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.heldBill.findUnique({
        where: { id },
        include: { user: { select: { id: true, fullName: true } } },
      });
      if (!row) throw notFound('Held bill');
      await tx.heldBill.delete({ where: { id } });
      await this.audit.log(
        {
          action: 'BILL_RECALL',
          userId: actor.user.id,
          entityType: 'HeldBill',
          entityId: id,
          summary: `Recalled a held bill${row.label ? ` (${row.label})` : ''}`,
        },
        tx,
      );
      return toDto(row);
    });
  }

  async discard(id: string, actor: Actor): Promise<void> {
    const row = await this.prisma.heldBill.findUnique({ where: { id } });
    if (!row) throw notFound('Held bill');
    await this.prisma.heldBill.delete({ where: { id } });
    await this.audit.log({
      action: 'BILL_HOLD_DISCARD',
      userId: actor.user.id,
      entityType: 'HeldBill',
      entityId: id,
      summary: `Discarded a held bill${row.label ? ` (${row.label})` : ''}`,
      before: row.cart,
    });
  }
}
