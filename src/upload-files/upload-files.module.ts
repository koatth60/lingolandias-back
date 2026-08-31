import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { S3Service } from './upload-files.service';
import { UploadController } from './upload-files.controller';
import { UsersModule } from 'src/users/users.module';
import { MeetingLogsModule } from 'src/meeting-logs/meeting-logs.module';
import { Recording } from './entities/recording.entity';
import { RecordingsRepository } from './recordings.repository';

@Module({
  imports: [UsersModule, MeetingLogsModule, TypeOrmModule.forFeature([Recording])],
  controllers: [UploadController],
  providers: [S3Service, RecordingsRepository],
})
export class UploadFilesModule {}
