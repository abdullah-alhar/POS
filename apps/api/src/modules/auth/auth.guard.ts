import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { hasPermission, type Permission } from '@shoppos/shared';
import { forbidden, unauthorized } from '../../common/app-exception';
import { IS_PUBLIC, REQUIRED_PERMISSIONS } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { SESSION_COOKIE, SESSION_RENEW_AFTER_SECONDS } from './auth.types';
import { SessionService, toRequestUser } from './session.service';

/**
 * Runs on every request: reads the session cookie, loads the user fresh from the database
 * (so a deactivated user is locked out at once) and checks @RequirePermissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const payload = token ? await this.sessions.verify(token) : null;

    if (payload) {
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (user && user.isActive && user.tokenVersion === payload.ver) {
        req.user = toRequestUser(user);
        const age = Math.floor(Date.now() / 1000) - (payload.iat ?? 0);
        if (age > SESSION_RENEW_AFTER_SECONDS) await this.sessions.start(res, user);
      }
    }

    if (isPublic) return true;
    if (!req.user) {
      if (token) this.sessions.end(res);
      throw unauthorized(token ? 'Your session has ended. Please log in again.' : 'Please log in');
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets);
    if (required?.length && !required.every((p) => hasPermission(req.user!, p))) {
      throw forbidden('You do not have permission to do this. Ask the shop owner.');
    }
    return true;
  }
}
