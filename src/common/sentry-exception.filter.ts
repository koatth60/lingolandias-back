import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

// Reports every unhandled exception to Sentry, then hands off to Nest's
// default handler so responses (status codes, error shape) are unchanged.
// Expected 4xx HttpExceptions (validation, auth, not-found) are noise, not
// bugs — only report what a 5xx or a non-HTTP throw actually represents.
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const isExpectedHttpError =
      exception instanceof HttpException && exception.getStatus() < 500;
    if (!isExpectedHttpError) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
