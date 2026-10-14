import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type {
  ChangePasswordInput,
  ChangePinInput,
  LoginInput,
  LoginTile,
  PinLoginInput,
  UpdateAvatarInput,
} from '@marina/shared';
import { forbidden, unauthorized } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import type { User } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttemptLimiter } from './attempt-limiter';
import { hashSecret, verifySecret } from './password';
import { SessionService, toRequestUser } from './session.service';

@Injectable()
export class AuthService {
  private readonly limiter = new AttemptLimiter(5, 5 * 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async tiles(): Promise<LoginTile[]> {
    return this.prisma.user.findMany({
      // The Super Admin (app maker) logs in with a username and password, not a shop tile.
      where: { isActive: true, role: { not: 'SUPER_ADMIN' } },
      select: { id: true, fullName: true, role: true, avatar: true },
      orderBy: [{ role: 'desc' }, { fullName: 'asc' }],
    });
  }

  async loginWithPassword(input: LoginInput, res: Response, ip?: string) {
    const key = `user:${input.username}`;
    this.limiter.assertAllowed(key);
    const user = await this.prisma.user.findUnique({ where: { username: input.username } });
    const ok = user?.isActive && (await verifySecret(input.password, user.passwordHash));
    if (!user || !ok) {
      this.limiter.fail(key);
      await this.audit.log({
        action: 'LOGIN_FAILED',
        userId: user?.id,
        summary: `Wrong password for "${input.username}"`,
        meta: { ip, method: 'password' },
      });
      throw unauthorized('Wrong username or password');
    }
    this.limiter.reset(key);
    return this.finishLogin(user, res, 'password', ip);
  }

  async loginWithPin(input: PinLoginInput, res: Response, ip?: string) {
    const key = `pin:${input.userId}`;
    this.limiter.assertAllowed(key);
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    const ok = user?.isActive && (await verifySecret(input.pin, user.pinHash));
    if (!user || !ok) {
      this.limiter.fail(key);
      await this.audit.log({
        action: 'LOGIN_FAILED',
        userId: user?.id,
        summary: `Wrong PIN for ${user?.fullName ?? 'unknown user'}`,
        meta: { ip, method: 'pin' },
      });
      throw unauthorized('Wrong PIN');
    }
    this.limiter.reset(key);
    return this.finishLogin(user, res, 'pin', ip);
  }

  private async finishLogin(user: User, res: Response, method: string, ip?: string) {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.sessions.start(res, updated);
    await this.audit.log({
      action: 'LOGIN',
      userId: user.id,
      entityType: 'User',
      entityId: user.id,
      summary: `${user.fullName} logged in`,
      meta: { ip, method },
    });
    const { tokenVersion: _, ...authUser } = toRequestUser(updated);
    return authUser;
  }

  async logout(actor: Actor | null, res: Response) {
    this.sessions.end(res);
    if (actor) {
      await this.audit.log({
        action: 'LOGOUT',
        userId: actor.user.id,
        summary: `${actor.user.fullName} logged out`,
      });
    }
  }

  async updateAvatar(input: UpdateAvatarInput, actor: Actor) {
    await this.prisma.user.update({ where: { id: actor.user.id }, data: { avatar: input.avatar } });
    await this.audit.log({
      action: 'AVATAR_CHANGE',
      userId: actor.user.id,
      entityType: 'User',
      entityId: actor.user.id,
      summary: `${actor.user.fullName} ${input.avatar ? 'changed' : 'removed'} their photo`,
    });
  }

  async changePassword(input: ChangePasswordInput, actor: Actor, res: Response) {
    const user = await this.checkPassword(actor.user.id, input.currentPassword);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashSecret(input.newPassword),
        // Log out other browsers that use the old password.
        tokenVersion: { increment: 1 },
      },
    });
    await this.sessions.start(res, updated);
    await this.audit.log({
      action: 'PASSWORD_CHANGE',
      userId: user.id,
      entityType: 'User',
      entityId: user.id,
      summary: `${user.fullName} changed their password`,
    });
  }

  async changePin(input: ChangePinInput, actor: Actor) {
    const user = await this.checkPassword(actor.user.id, input.currentPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { pinHash: await hashSecret(input.newPin) },
    });
    await this.audit.log({
      action: 'PIN_CHANGE',
      userId: user.id,
      entityType: 'User',
      entityId: user.id,
      summary: `${user.fullName} changed their PIN`,
    });
  }

  private async checkPassword(userId: string, password: string) {
    const key = `pw:${userId}`;
    this.limiter.assertAllowed(key);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifySecret(password, user.passwordHash))) {
      this.limiter.fail(key);
      throw forbidden('Your current password is wrong');
    }
    this.limiter.reset(key);
    return user;
  }
}
