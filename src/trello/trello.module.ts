import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrelloController } from './trello.controller';
import { TrelloService } from './trello.service';
import { TrelloBoard } from './entities/trello-board.entity';
import { TrelloList } from './entities/trello-list.entity';
import { TrelloCard } from './entities/trello-card.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TrelloBoard, TrelloList, TrelloCard])],
  controllers: [TrelloController],
  providers: [TrelloService],
  exports: [TrelloService],
})
export class TrelloModule {}
