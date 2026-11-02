import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

type ErrorDetail = { field?: string; code: string; message: string };

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();
    const correlationId =
      request.correlationId ?? response.getHeader('x-correlation-id')?.toString() ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: ErrorDetail[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const value = body as Record<string, unknown>;
        const rawMessage = value.message;
        if (Array.isArray(rawMessage)) {
          message = 'Validation failed';
          details = rawMessage.map((m) => ({ code: 'VALIDATION', message: String(m) }));
        } else {
          message = typeof rawMessage === 'string' ? rawMessage : exception.message;
        }
        if (typeof value.code === 'string') code = value.code;
        if (Array.isArray(value.details)) details = value.details as ErrorDetail[];
      }
      if (code === 'INTERNAL_ERROR') {
        switch (status) {
          case HttpStatus.BAD_REQUEST:
            code = 'BAD_REQUEST';
            break;
          case HttpStatus.UNAUTHORIZED:
            code = 'UNAUTHENTICATED';
            break;
          case HttpStatus.FORBIDDEN:
            code = 'FORBIDDEN';
            break;
          case HttpStatus.NOT_FOUND:
            code = 'NOT_FOUND';
            break;
          case HttpStatus.CONFLICT:
            code = 'CONFLICT';
            break;
          case HttpStatus.UNPROCESSABLE_ENTITY:
            code = 'UNPROCESSABLE';
            break;
          case HttpStatus.TOO_MANY_REQUESTS:
            code = 'RATE_LIMITED';
            break;
          default:
            code = 'ERROR';
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'DUPLICATE';
        message = 'A record with this value already exists';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Record not found';
      } else {
        this.logger.error(exception.message, exception.stack);
      }
    } else {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      error: {
        code,
        message,
        correlationId,
        details,
      },
    });
  }
}
