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

  // Null = full history visible (the default — everyone who was already in
  // the conversation keeps seeing everything). Set only when someone is
  // added and explicitly NOT given the prior history — messages before this
  // timestamp are hidden from just this member.
  @Column({ type: 'timestamp', nullable: true })
  historyVisibleFrom?: Date;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: 'boolean', default: false })
  muted: boolean;

  // Per-member "delete for me" — hides the conversation from their list
  // without touching it for anyone else. Cleared automatically (via
  // markRead-style logic) if a new message arrives after this timestamp.
  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;

  @CreateDateColumn({ type: 'timestamp' })
  joinedAt: Date;
}
