import type { CashSession } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/**
 * The open cash day, started automatically when nobody opened it: the first sale, cash refund,
 * customer cash payment, drawer expense or cash in / out of the day opens it, with no cash in the
 * drawer (the opening cash can be set later on the Cash page). Nobody has to "open the day".
 */
export async function openDayIfNeeded(tx: Tx, userId: string): Promise<CashSession> {
  const open = await tx.cashSession.findFirst({ where: { status: 'OPEN' } });
  if (open) return open;
  // Only one request opens it; the others wait and then find it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4201)`;
  const again = await tx.cashSession.findFirst({ where: { status: 'OPEN' } });
  if (again) return again;
  const session = await tx.cashSession.create({ data: { openingCash: 0, openedById: userId } });
  await tx.auditLog.create({
    data: {
      action: 'DAY_OPEN',
      userId,
      entityType: 'CashSession',
      entityId: session.id,
      summary: 'The day started with the first sale or cash movement',
    },
  });
  return session;
}
