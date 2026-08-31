import { Module } from '@nestjs/common';
import { VideoCallsGateway } from 'src/videocalls.gateaway';
import { ChatModule } from 'src/chat/chat.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { ConversationsModule } from 'src/conversations/conversations.module';

@Module({
  imports: [ChatModule, TypeOrmModule.forFeature([User]), ConversationsModule],
  providers: [VideoCallsGateway],
  exports: [VideoCallsGateway],
})
export class GatewayModule {}
