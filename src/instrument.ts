// Must be imported first, before any other module, so Sentry can instrument
// everything else (http, pg, etc.) as they're required. See main.ts. Loads
// its own dotenv config rather than relying on config/typeorm.ts's side
// effect — that file (and its dotenvConfig call) hasn't been required yet
// at this point, so process.env.SENTRY_DSN would otherwise still be unset.
import { config as dotenvConfig } from 'dotenv';
import * as Sentry from '@sentry/node';

dotenvConfig({ path: '.env.development' });

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
  });
  console.log('Sentry error monitoring initialized');
} else {
  console.log('SENTRY_DSN not set — error monitoring disabled');
}
