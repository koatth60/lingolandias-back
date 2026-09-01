import { Module } from '@nestjs/common';
import { ScheduleBroadcaster } from './schedule-broadcaster.service';

@Module({
  providers: [ScheduleBroadcaster],
  exports: [ScheduleBroadcaster],
})
export class ScheduleBroadcasterModule {}
