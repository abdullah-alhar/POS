import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { APPROVAL_HEADER, type Permission } from '@shoppos/shared';
import type { RequestUser } from '../modules/auth/auth.types';
import { unauthorized } from './app-exception';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_PERMISSIONS = 'requiredPermissions';

/** No login needed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The user needs all of these permissions (admins always pass). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Who is making the request, plus any admin approval token they sent. */
export interface Actor {
  user: RequestUser;
  /** Admin approval tokens sent in the x-approval-token header (comma separated). */
  approvalTokens: string[];
  ip?: string;
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.user) throw unauthorized();
  const header = req.headers[APPROVAL_HEADER];
  return {
    user: req.user,
    approvalTokens:
      typeof header === 'string'
        ? header
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 5)
        : [],
    ip: req.ip,
  };
});
