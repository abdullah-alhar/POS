import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorBody, ApprovalAction, ErrorCode } from '@marina/shared';

/** Every error we throw on purpose. The filter turns it into an ApiErrorBody. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Pick<ApiErrorBody, 'fields' | 'details'> = {},
  ) {
    super({ statusCode: status, code, message, ...extra } satisfies ApiErrorBody, status);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppException(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', message, { fields });

export const notFound = (what: string) =>
  new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);

export const conflict = (message: string, fields?: Record<string, string>) =>
  new AppException(HttpStatus.CONFLICT, 'CONFLICT', message, { fields });

export const forbidden = (message = 'You are not allowed to do this') =>
  new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);

export const unauthorized = (message = 'Please log in') =>
  new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);

export const tooManyAttempts = (retryAfterSeconds: number) =>
  new AppException(
    HttpStatus.TOO_MANY_REQUESTS,
    'TOO_MANY_ATTEMPTS',
    `Too many wrong attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
    { details: { retryAfterSeconds } },
  );

export const approvalRequired = (action: ApprovalAction, message: string) =>
  new AppException(HttpStatus.FORBIDDEN, 'APPROVAL_REQUIRED', message, { details: { action } });
