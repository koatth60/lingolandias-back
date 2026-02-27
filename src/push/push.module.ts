import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from './push-subscription.entity';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { Schedule } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription, Schedule])],
  controllers: [PushController],
  providers: [PushService],
})
export class PushModule {}
