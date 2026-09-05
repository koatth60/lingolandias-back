import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('settings')
export class Settings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'boolean', default: false })
  darkMode: boolean;

  @Column({ type: 'boolean', default: true })
  notificationSound: boolean;

  @Column({ type: 'varchar', default: 'en' })
  language: string;

  @Column({ type: 'boolean', default: false })
  classReminders: boolean;

  // Opt-in desktop/OS push notification for new chat messages — separate
  // toggle from classReminders since a user may want one without the other,
  // but they share the same underlying browser push subscription (one per
  // device/origin) — see Settings.jsx's shared subscribe/unsubscribe helper.
  @Column({ type: 'boolean', default: false })
  messageNotifications: boolean;

  @Column({ type: 'boolean', default: false })
  watchedTutorial: boolean;

  // Opt-in push + email heads-up when a Trello 2.0 card's due date is within
  // 24h — shares the same browser push subscription as classReminders /
  // messageNotifications (see Settings.jsx).
  @Column({ type: 'boolean', default: false })
  cardDueReminders: boolean;

  // Crash-course video tutorial (src/sections/course.jsx) — replaces the old
  // single-video watchedTutorial modal. Map of videoId -> true for every
  // video the user has finished (or manually marked as watched).
  @Column({ type: 'jsonb', default: {} })
  courseProgress: Record<string, boolean>;

  // Whether the one-time "there's a new course" banner on the Home page has
  // already been shown/dismissed. Separate from courseProgress so it stops
  // nagging returning users even if they never actually open the course.
  @Column({ type: 'boolean', default: false })
  courseAnnouncementSeen: boolean;

  @OneToOne(() => User, (user) => user.settings, {
  onDelete: 'CASCADE'  
})
@JoinColumn()
user: User;
}