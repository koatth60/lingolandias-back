import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  // OneToMany,
} from 'typeorm';
// import { UnreadGlobalMessage } from './unread-global-messages.entity';

@Index(['room', 'timestamp'])
@Entity('global-chats')
export class GlobalChat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  username: string;

  @Column({ type: 'varchar', length: 100 })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatarUrl?: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  room: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userUrl?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  fileUrl?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  userRole?: string;

  @Column({ default: 0 })
  unreadCount: number;

  @CreateDateColumn({ type: 'timestamp' })
  timestamp: Date;

  @Column({ type: 'timestamp', nullable: true })
  editedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  replyTo?: { id: string; message: string; username: string } | null;

  // Emoji -> who reacted with it (id + display name) — same shape as
  // Message.reactions in the unified conversation model, kept separate here
  // since global-chats (support/general rooms) predates and isn't part of
  // that model.
  @Column({ type: 'jsonb', nullable: true })
  reactions?: Record<string, { id: string; name: string }[]> | null;

  // @OneToMany(
  //   () => UnreadGlobalMessage,
  //   (unreadMessage) => unreadMessage.message,
  // )
  // unreadMessages: UnreadGlobalMessage[];
}
