import type { AuthUser } from '@shoppos/shared';

export const SESSION_COOKIE = 'pos_session';
export const SESSION_HOURS = 12;
/** Re-issue the cookie when it is older than this, so active users stay logged in. */
export const SESSION_RENEW_AFTER_SECONDS = 15 * 60;
export const APPROVAL_TOKEN_SECONDS = 120;

export interface SessionPayload {
  typ: 'session';
  sub: string;
  ver: number;
  iat?: number;
  exp?: number;
}

export interface ApprovalPayload {
  typ: 'approval';
  /** Admin who typed their PIN. */
  sub: string;
  act: string;
  /** User who asked for approval. */
  req: string;
  jti: string;
  exp?: number;
}

/** The logged-in user attached to each request. */
export interface RequestUser extends AuthUser {
  tokenVersion: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}
