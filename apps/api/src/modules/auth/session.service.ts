import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { effectivePermissions } from '@shoppos/shared';
import { config } from '../../config';
import type { User } from '../../generated/prisma/client';
import { SESSION_COOKIE, SESSION_HOURS, type RequestUser, type SessionPayload } from './auth.types';

@Injectable()
export class SessionService {
  constructor(private readonly jwt: JwtService) {}

  async start(res: Response, user: Pick<User, 'id' | 'tokenVersion'>) {
    const payload: SessionPayload = { typ: 'session', sub: user.id, ver: user.tokenVersion };
    const token = await this.jwt.signAsync(payload, { expiresIn: `${SESSION_HOURS}h` });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config().cookieSecure,
      path: '/',
      maxAge: SESSION_HOURS * 3600_000,
    });
  }

  end(res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict' });
  }

  async verify(token: string): Promise<SessionPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<SessionPayload>(token);
      return payload.typ === 'session' ? payload : null;
    } catch {
      return null;
    }
  }
}

export function toRequestUser(user: User): RequestUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    permissions: effectivePermissions(user.role, user.permissions),
    avatar: user.avatar,
    tokenVersion: user.tokenVersion,
  };
}
