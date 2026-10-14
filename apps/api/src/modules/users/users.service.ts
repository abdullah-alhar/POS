import { Injectable } from '@nestjs/common';
import {
  effectivePermissions,
  isAdminRole,
  type Role,
  type CreateUserInput,
  type ResetCredentialsInput,
  type UpdateUserInput,
  type UserDto,
} from '@marina/shared';
import { badRequest, conflict, forbidden, notFound } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { User } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../auth/password';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    permissions: effectivePermissions(user.role, user.permissions),
    isActive: user.isActive,
    avatar: user.avatar,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Audit entries keep a marker instead of the whole photo. */
function forAudit(user: User) {
  const dto = toUserDto(user);
  return { ...dto, avatar: dto.avatar ? '[photo]' : null };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The shop admin never sees the Super Admin account. */
  async list(actor: Actor): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({
      where: actor.user.role === 'SUPER_ADMIN' ? undefined : { role: { not: 'SUPER_ADMIN' } },
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { fullName: 'asc' }],
    });
    return users.map(toUserDto);
  }

  async create(input: CreateUserInput, actor: Actor): Promise<UserDto> {
    this.assertMayGrantRole(actor, input.role);
    const exists = await this.prisma.user.findUnique({ where: { username: input.username } });
    if (exists) throw conflict('This username is already taken', { username: 'Already taken' });

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: input.username,
          fullName: input.fullName,
          role: input.role,
          passwordHash: await hashSecret(input.password),
          pinHash: await hashSecret(input.pin),
          permissions: isAdminRole(input.role) ? [] : input.permissions,
          avatar: input.avatar ?? null,
        },
      });
      await this.audit.log(
        {
          action: 'USER_CREATE',
          userId: actor.user.id,
          entityType: 'User',
          entityId: user.id,
          summary: `Added user ${user.fullName} (${user.role.toLowerCase()})`,
          after: forAudit(user),
        },
        tx,
      );
      return toUserDto(user);
    });
  }

  async update(id: string, input: UpdateUserInput, actor: Actor): Promise<UserDto> {
    const user = await this.findManageable(id, actor);
    if (input.role) this.assertMayGrantRole(actor, input.role);

    if (id === actor.user.id) {
      if (input.isActive === false) throw badRequest('You cannot deactivate yourself');
      if (input.role && input.role !== user.role)
        throw badRequest('You cannot change your own role');
    }

    return this.prisma.$transaction(async (tx) => {
      const losingAdmin =
        isAdminRole(user.role) &&
        user.isActive &&
        (input.isActive === false || (input.role !== undefined && !isAdminRole(input.role)));
      if (losingAdmin) await this.assertAnotherAdmin(tx, id);

      const role = input.role ?? user.role;
      const updated = await tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName,
          role: input.role,
          permissions: isAdminRole(role) ? [] : input.permissions,
          isActive: input.isActive,
          avatar: input.avatar,
        },
      });
      await this.audit.log(
        {
          action: 'USER_UPDATE',
          userId: actor.user.id,
          entityType: 'User',
          entityId: id,
          summary: `Changed user ${updated.fullName}`,
          before: forAudit(user),
          after: forAudit(updated),
        },
        tx,
      );
      return toUserDto(updated);
    });
  }

  async resetCredentials(id: string, input: ResetCredentialsInput, actor: Actor) {
    const user = await this.findManageable(id, actor);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(input.password && {
            passwordHash: await hashSecret(input.password),
            tokenVersion: { increment: 1 },
          }),
          ...(input.pin && { pinHash: await hashSecret(input.pin) }),
        },
      });
      const what = [input.password && 'password', input.pin && 'PIN'].filter(Boolean).join(' and ');
      await this.audit.log(
        {
          action: 'USER_RESET_CREDENTIALS',
          userId: actor.user.id,
          entityType: 'User',
          entityId: id,
          summary: `Reset ${what} for ${user.fullName}`,
        },
        tx,
      );
    });
  }

  /** Only the Super Admin may see or change a Super Admin account. */
  private async findManageable(id: string, actor: Actor) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || (user.role === 'SUPER_ADMIN' && actor.user.role !== 'SUPER_ADMIN')) {
      throw notFound('User');
    }
    return user;
  }

  private assertMayGrantRole(actor: Actor, role: Role) {
    if (role === 'SUPER_ADMIN' && actor.user.role !== 'SUPER_ADMIN') {
      throw forbidden('Only the Super Admin can create Super Admin accounts');
    }
  }

  private async assertAnotherAdmin(tx: Tx, exceptId: string) {
    const others = await tx.user.count({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true, id: { not: exceptId } },
    });
    if (others === 0) throw badRequest('The shop must always have at least one active admin');
  }
}
