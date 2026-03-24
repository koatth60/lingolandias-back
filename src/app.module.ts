import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import TypeOrmConfig from './config/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from './users/users.module';
import { UploadFilesModule } from './upload-files/upload-files.module';
import { MailModule } from './mail/mail.module';
import mailConfig from './config/mail.config';
import { ScheduleModule } from '@nestjs/schedule';
import { SettingsModule } from './settings/settings.module';
import { TrelloModule } from './trello/trello.module';
import { PushModule } from './push/push.module';
import { ClassSessionsModule } from './class-sessions/class-sessions.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,   // 1 minute window
        limit: 120,   // 120 requests per minute per IP
      },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [TypeOrmConfig, mailConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '8h' },
    }),
    AuthModule,
    ChatModule,
    UsersModule,
    UploadFilesModule,
    MailModule,
    SettingsModule,
    TrelloModule,
    PushModule,
    ClassSessionsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
