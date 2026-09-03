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

  @OneToOne(() => User, (user) => user.settings, {
  onDelete: 'CASCADE'  
})
@JoinColumn()
user: User;
}