import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassSession } from './entities/class-session.entity';
import { ClassSessionsService } from './class-sessions.service';
import { ClassSessionsController } from './class-sessions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ClassSession])],
  controllers: [ClassSessionsController],
  providers: [ClassSessionsService],
})
export class ClassSessionsModule {}
