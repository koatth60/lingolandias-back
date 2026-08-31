import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { Schedule, User } from 'src/users/entities/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersRepository } from 'src/users/users.repository';
import { ScheduleRepository } from 'src/users/schedule.repository';
import { MailService } from 'src/mail/mail.service';
import { UsersModule } from 'src/users/users.module';
import { ChatModule } from '../chat/chat.module';
import { GatewayModule } from 'src/gateway/gateway.module';
import { ConversationsModule } from 'src/conversations/conversations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Schedule,
    ]),
    UsersModule,
    ChatModule,
    GatewayModule,
    ConversationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    ScheduleRepository,
    MailService,
  ],
})
export class AuthModule {}
