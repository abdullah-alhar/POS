import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody, ErrorCode } from '@marina/shared';
import { Prisma } from '../generated/prisma/client';

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
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
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
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again; if it keeps happening, call support.',
    };
  }
}
