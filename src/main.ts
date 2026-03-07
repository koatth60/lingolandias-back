import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
const PORT = 2000;
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

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
