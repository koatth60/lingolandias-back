import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { TrelloList } from './trello-list.entity';

@Entity('trello_cards')
export class TrelloCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 500 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Index()
  @Column({ type: 'varchar' })
  listId: string;

  @ManyToOne(() => TrelloList, (list) => list.cards, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'listId' })
  list: TrelloList;

  @Column({ type: 'timestamp', nullable: true })
  dueDate: Date;

  @Column({ type: 'text', nullable: true })
  label: string;

  @Column({ type: 'text', nullable: true })
  checklist: string; // JSON: [{id,text,done}]

  @Column({ type: 'text', nullable: true })
  comments: string; // JSON: [{id,text,author,createdAt}]

  @Column({ type: 'text', nullable: true })
  titleStyle: string; // JSON: {fontFamily,fontSize,color,fontWeight,fontStyle}

  // Set once TrelloReminderService has notified the board owner this card is
  // due soon — prevents re-notifying every cron tick. Reset to false whenever
  // dueDate changes (see TrelloService.updateCard) so editing the date re-arms it.
  @Column({ type: 'boolean', default: false })
  reminderSent: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
