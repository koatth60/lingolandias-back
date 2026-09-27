import './instrument'; // must be first — see file for why
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './common/sentry-exception.filter';
import helmet from 'helmet';
import { allowedOrigins } from './common/cors-origins';
const PORT = 2000;
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  app.useGlobalFilters(
    new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter),
  );

  // Everything in production arrives through nginx. Without this, Express
  // (and therefore ThrottlerGuard, which keys its counters off req.ip) sees
  // every single client as 127.0.0.1 — nginx's own address — so the rate
  // limit below was effectively one shared budget for the whole platform,
  // not per visitor. `1` trusts exactly one hop (nginx) and reads the real
  // client from the X-Forwarded-For it sets.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Almost every controller here still takes `@Body() body: any`, which
  // class-validator's ValidationPipe already skips (its reflected type is
  // `Object`, and only a real DTO class gets validated) — so this is safe to
  // turn on globally. Before this, no pipe was bound anywhere at all, so the
  // handful of DTOs that already carried class-validator decorators
  // (ResetPasswordDto, UpdateSettingsDto) silently
  // enforced nothing: a password reset accepted a 1-character password, and
  // an out-of-range settings page number was passed straight through.
  //
  // `forbidNonWhitelisted` is deliberately left off: it would turn any extra
  // field a client sends on a DTO'd route into a hard 400, and this session
  // couldn't audit every existing payload against every DTO closely enough
  // to be sure nothing sends one. `whitelist` alone silently drops anything
  // undeclared, which is what already needed doing to every DTO that had no
  // decorators at all (they were one whitelist flip away from every field
  // vanishing) — see ContactDto, NewsletterDto, ChangePasswordDto,
  // DeleteUnreadDto and SupportEmailDto, now decorated for exactly that.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.use(
    helmet({
      frameguard: { action: 'sameorigin' },
      contentSecurityPolicy: false, // gestionado en nginx
    }),
  );

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  });

  await app.listen(2000, () => {
    console.log(`NestJS application is running on http://localhost:${PORT}`);
  });
}

bootstrap();
