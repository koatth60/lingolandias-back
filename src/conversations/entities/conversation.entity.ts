import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

// 'general'/'teacher'/'support' preserve the 7 legacy fixed rooms (their id is
// kept as the literal string used today, e.g. "uuid-english", since that same
// string is also the Jitsi room name for teacher meetings). 'dm' preserves
// existing 1:1 rooms with id = the student's own user id, for the same reason
// (that id doubles as the Jitsi room name). 'group' is new.
export type ConversationType = 'dm' | 'group' | 'general' | 'teacher' | 'support';

@Entity('conversations')
export class Conversation {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  type: ConversationType;

  @Column({ type: 'varchar', length: 150, nullable: true })
  name?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl?: string;

  // Only set for general/teacher rooms, replacing the old regex-on-room-id
  // membership rule with a plain data column.
  @Column({ type: 'varchar', length: 20, nullable: true })
  language?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ type: 'boolean', default: false })
  linkedToSchedule: boolean;

  // Once someone manually renames a group, stop auto-recomputing its name
  // from the member list when membership changes.
  @Column({ type: 'boolean', default: false })
  nameIsCustom: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
