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

  // Emoji -> who reacted with it (id + display name, so a hover tooltip can
  // show names without a separate member-list lookup). An emoji key is
  // removed once its array is empty rather than kept around as [].
  @Column({ type: 'jsonb', nullable: true })
  reactions?: Record<string, { id: string; name: string }[]> | null;

  // 'text' (default/omitted), 'missed_call', or one of the system-event
  // types ('member_added', 'member_removed', 'member_left',
  // 'group_renamed') — all of the latter render as a centered log line
  // (no avatar/bubble) built from `metadata` instead of `message`.
  // senderId is null for system events; username/email hold the ACTOR
  // (who performed the action), not a message author.
  @Column({ type: 'varchar', length: 20, nullable: true })
  messageType?: string;

  // Structured data for system-event messages, e.g.
  // { targetName } for member_added/member_removed/member_left, or
  // { oldName, newName } for group_renamed. Rendered client-side via i18n
  // so it reads in the viewer's own language regardless of who triggered it.
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  editedAt?: Date;

  @CreateDateColumn({ type: 'timestamp' })
  timestamp: Date;
}
