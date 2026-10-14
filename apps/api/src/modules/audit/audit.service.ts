import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export interface AuditEntry {
  action: string;
  userId?: string | null;
  approvedById?: string | null;
  entityType?: string;
  entityId?: string;
  /** One readable line, e.g. "Changed price of Anker 20W from Rs 4,500 to Rs 3,900". */
  summary?: string;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
}

const json = (v: unknown) =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Write an audit entry. Pass the transaction client so it is saved together with the change. */
  async log(entry: AuditEntry, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId ?? null,
        approvedById: entry.approvedById ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary,
        before: json(entry.before),
        after: json(entry.after),
        meta: json(entry.meta),
      },
    });
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
