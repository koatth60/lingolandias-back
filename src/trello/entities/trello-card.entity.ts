import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
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

  @Column({ type: 'varchar' })
  listId: string;

  @ManyToOne(() => TrelloList, (list) => list.cards, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'listId' })
  list: TrelloList;

  @Column({ type: 'timestamp', nullable: true })
  dueDate: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  label: string;

  @Column({ type: 'text', nullable: true })
  checklist: string; // JSON: [{id,text,done}]

  @Column({ type: 'text', nullable: true })
  comments: string; // JSON: [{id,text,author,createdAt}]

  @Column({ type: 'text', nullable: true })
  titleStyle: string; // JSON: {fontFamily,fontSize,color,fontWeight,fontStyle}

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
