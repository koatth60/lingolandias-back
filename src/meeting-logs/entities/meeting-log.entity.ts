import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(['roomId', 'createdAt'])
@Index(['event', 'createdAt'])
@Entity()
export class MeetingLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  roomId: string;

  @Index()
  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  userName: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  role: string;

  @Column()
  event: string;

  @Column({ default: 'info' })
  level: string;

  @Column({ type: 'text', nullable: true })
  detail: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;
}
