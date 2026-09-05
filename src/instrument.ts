// Must be imported first, before any other module, so Sentry can instrument
// everything else (http, pg, etc.) as they're required. See main.ts.
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
  });
}
