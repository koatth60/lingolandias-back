import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingLog } from './entities/meeting-log.entity';
import { MeetingLogsService } from './meeting-logs.service';
import { MeetingLogsController } from './meeting-logs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MeetingLog])],
  controllers: [MeetingLogsController],
  providers: [MeetingLogsService],
  exports: [MeetingLogsService],
})
export class MeetingLogsModule {}
