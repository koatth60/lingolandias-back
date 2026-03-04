import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TrelloList } from './trello-list.entity';

@Entity('trello_boards')
export class TrelloBoard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100, default: '#0079BF' })
  background: string;

  @Column({ type: 'varchar', length: 100, default: 'Inter' })
  fontFamily: string;

  @Column({ type: 'varchar' })
  userId: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => TrelloList, (list) => list.board, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  lists: TrelloList[];
}
