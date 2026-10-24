import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorBody, ErrorCode } from '@shoppos/shared';
import { Prisma } from '../generated/prisma/client';
import { newRef, recordProblem } from './problems';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_ATTEMPTS',
};

/** Turns every error into the same JSON shape, with messages a cashier can understand. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { user?: { username?: string } }>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      // A reference to find this error again: shown to the user, logged, listed in Settings.
      body.ref = newRef();
      const stack =
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error(
        `[${body.ref}] ${body.code} ${req.method} ${req.originalUrl ?? req.url}: ${stack}`,
      );
      recordProblem({
        ref: body.ref,
        at: new Date().toISOString(),
        code: body.code,
        status: body.statusCode,
        method: req.method,
        path: (req.originalUrl ?? req.url ?? '').split('?')[0]!.slice(0, 200),
        user: req.user?.username ?? null,
        message: body.message,
        detail: stack.split('\n').slice(0, 6).join('\n').slice(0, 1500),
      });
      if (body.code === 'INTERNAL' || body.code.startsWith('DB_'))
        body.message = `${body.message} (code ${body.code}, ref ${body.ref})`;
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response && 'code' in response) {
        return response as ApiErrorBody;
      }
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return {
        statusCode: status,
        code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
        message: Array.isArray(message) ? message.join(', ') : message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          const target = (exception.meta?.target as string[] | string | undefined) ?? 'value';
          const field = Array.isArray(target) ? target.join(', ') : target;
          return {
            statusCode: HttpStatus.CONFLICT,
            code: 'CONFLICT',
            message: `This ${field} is already used`,
          };
        }
        case 'P2025':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            code: 'NOT_FOUND',
            message: 'Record not found',
          };
        case 'P2003':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: 'CONFLICT',
            message: 'This record is linked to other records and cannot be changed this way',
          };
        case 'P2021':
        case 'P2022':
          return {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            code: 'DB_OUTDATED',
            message:
              'The database needs the latest update. Run UPDATE.cmd (or pnpm db:deploy), then try again.',
          };
        case 'P2024':
          return {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            code: 'DB_TIMEOUT',
            message: 'The database is busy. Wait a moment and try again.',
          };
      }
    }
    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      (exception instanceof Prisma.PrismaClientKnownRequestError &&
        ['P1001', 'P1002', 'P1017'].includes(exception.code)) ||
      (exception instanceof Error &&
        /ECONNREFUSED|Can't reach database|terminating connection/i.test(exception.message))
    ) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'DB_UNAVAILABLE',
        message:
          'The database is not running. Restart the POS computer; if it stays, call support.',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again; if it keeps happening, call support.',
    };
  }
}
