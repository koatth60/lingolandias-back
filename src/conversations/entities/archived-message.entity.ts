import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Mirrors Message, but keeps avatarUrl/userUrl/fileUrl/replyTo (the old
// ArchivedChat dropped those fields on archive — fixed here so nothing is
// lost once messages age out of the active table).
@Index(['conversationId', 'timestamp'])
@Entity('archived_messages')
export class ArchivedMessage {
  @PrimaryColumn({ type: 'uuid' })
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

  @Column({ type: 'jsonb', nullable: true })
  replyTo?: { id: string; message: string; username: string } | null;

  @Column({ type: 'jsonb', nullable: true })
  reactions?: Record<string, { id: string; name: string }[]> | null;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ type: 'timestamp' })
  archivedAt: Date;
}
