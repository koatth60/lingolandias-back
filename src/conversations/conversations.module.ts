import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { ArchivedMessage } from './entities/archived-message.entity';
import { Schedule, User } from '../users/entities/user.entity';
import { ConversationsRepository } from './conversations.repository';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { ScheduleBroadcasterModule } from '../gateway/schedule-broadcaster.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationMember,
      Message,
      ArchivedMessage,
      User,
      Schedule,
    ]),
    ScheduleBroadcasterModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsRepository, ConversationsService],
  exports: [TypeOrmModule, ConversationsRepository, ConversationsService],
})
export class ConversationsModule {}
