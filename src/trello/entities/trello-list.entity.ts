import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { TrelloBoard } from './trello-board.entity';
import { TrelloCard } from './trello-card.entity';

@Entity('trello_lists')
export class TrelloList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Index()
  @Column({ type: 'varchar' })
  boardId: string;

  @ManyToOne(() => TrelloBoard, (board) => board.lists, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'boardId' })
  board: TrelloBoard;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => TrelloCard, (card) => card.list, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  cards: TrelloCard[];
}
