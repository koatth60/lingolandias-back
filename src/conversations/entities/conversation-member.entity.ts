import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Index(['conversationId', 'userId'], { unique: true })
@Entity('conversation_members')
export class ConversationMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  conversationId: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20, default: 'member' })
  role: 'owner' | 'member';

  // Drives unread-count computation (messages after this timestamp are
  // unread), replacing the old fixed-column-per-room counters.
  @Column({ type: 'timestamp', nullable: true })
  lastReadAt?: Date;

  @CreateDateColumn({ type: 'timestamp' })
  joinedAt: Date;
}
