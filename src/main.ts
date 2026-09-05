import './instrument'; // must be first — see file for why
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './common/sentry-exception.filter';
import helmet from 'helmet';
const PORT = 2000;
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  app.useGlobalFilters(
    new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter),
  );

  app.use(
    helmet({
      frameguard: { action: 'sameorigin' },
      contentSecurityPolicy: false, // gestionado en nginx
    }),
  );

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Authorization',
  });

  await app.listen(2000, () => {
    console.log(`NestJS application is running on http://localhost:${PORT}`);
  });
}

bootstrap();
