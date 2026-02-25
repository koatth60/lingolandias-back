import { Module } from '@nestjs/common';
import { VideoCallsGateway } from 'src/videocalls.gateaway';
import { ChatModule } from 'src/chat/chat.module';

@Module({
  imports: [ChatModule],
  providers: [VideoCallsGateway],
  exports: [VideoCallsGateway],
})
export class GatewayModule {}
