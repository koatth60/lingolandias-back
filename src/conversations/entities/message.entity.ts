import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Index(['conversationId', 'timestamp'])
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  conversationId: string;

  @Column({ type: 'uuid', nullable: true })
  senderId?: string;

  @Column({ type: 'varchar', length: 100 })
  username: string;

  @Column({ type: 'varchar', length: 100 })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatarUrl?: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  fileUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userUrl?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  userRole?: string;

  @Column({ type: 'jsonb', nullable: true })
  replyTo?: { id: string; message: string; username: string } | null;

  // Emoji -> array of userIds who reacted with it. An emoji key is removed
  // once its array is empty rather than kept around as [].
  @Column({ type: 'jsonb', nullable: true })
  reactions?: Record<string, string[]> | null;

  // 'text' (default/omitted) or 'missed_call' — the latter renders with a
  // distinct look + a Join button in the client instead of as a normal
  // bubble. senderId is the person who started the unanswered call.
  @Column({ type: 'varchar', length: 20, nullable: true })
  messageType?: string;

  @Column({ type: 'timestamp', nullable: true })
  editedAt?: Date;

  @CreateDateColumn({ type: 'timestamp' })
  timestamp: Date;
}
