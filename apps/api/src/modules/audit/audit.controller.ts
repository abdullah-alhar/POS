import { Controller, Get, Module, Query } from '@nestjs/common';
import { auditQuerySchema, type AuditEntryDto, type AuditQuery, type Page } from '@marina/shared';
import { RequirePermissions } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

function dayStart(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Read-only view of who did what. Entries are never edited or deleted. */
@Controller('audit')
@RequirePermissions('audit.view')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query(new ZodPipe(auditQuerySchema)) q: AuditQuery): Promise<Page<AuditEntryDto>> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = dayStart(q.from);
    if (q.to) {
      const end = dayStart(q.to);
      end.setDate(end.getDate() + 1);
      createdAt.lt = end;
    }
    const where: Prisma.AuditLogWhereInput = {
      createdAt: q.from || q.to ? createdAt : undefined,
      userId: q.userId,
      action: q.action || undefined,
      ...(q.q && {
        OR: [
          { summary: { contains: q.q, mode: 'insensitive' } },
          { entityId: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: { select: { fullName: true } },
          approvedBy: { select: { fullName: true } },
        },
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        userName: r.user?.fullName ?? null,
        approvedByName: r.approvedBy?.fullName ?? null,
        entityType: r.entityType,
        entityId: r.entityId,
        summary: r.summary,
        before: r.before,
        after: r.after,
        meta: r.meta,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  @Get('actions')
  async actions(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }
}

@Module({ controllers: [AuditController] })
export class AuditViewModule {}
