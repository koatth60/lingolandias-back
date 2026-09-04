import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrelloController } from './trello.controller';
import { TrelloService } from './trello.service';
import { TrelloReminderService } from './trello-reminder.service';
import { TrelloImportService } from './trello-import.service';
import { TrelloBoard } from './entities/trello-board.entity';
import { TrelloList } from './entities/trello-list.entity';
import { TrelloCard } from './entities/trello-card.entity';
import { User } from '../users/entities/user.entity';
import { PushModule } from '../push/push.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrelloBoard, TrelloList, TrelloCard, User]),
    PushModule,
  ],
  controllers: [TrelloController],
  providers: [TrelloService, TrelloReminderService, TrelloImportService],
  exports: [TrelloService],
})
export class TrelloModule {}
