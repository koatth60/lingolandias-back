import { UnreadGlobalMessage } from 'src/chat/entities/unread-global-messages.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { Settings } from './settings.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({ type: 'varchar' })
  password: string;

  @Column({ type: 'varchar', nullable: true })
  language: string;

  @Column({ type: 'enum', enum: ['online', 'offline'], default: 'offline' })
  online: string;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string;

  @Column({ type: 'varchar', nullable: true })
  coverUrl: string;

  // Deliberately NOT @CreateDateColumn — that would backfill every
  // pre-existing row with the migration's run time via a DB-level DEFAULT,
  // which would show a fake "member since" date for every current user.
  // Nullable with no default: old rows stay null (hidden in the UI), new
  // rows get a real value set explicitly at registration.
  @Column({ type: 'timestamp', nullable: true })
  createdAt: Date;

  @Column({ type: 'text', nullable: true })
  biography: string;

  @Column({ type: 'varchar', nullable: true })
  country: string;

  @Column({ type: 'varchar', nullable: true })
  city: string;

  @Column({ type: 'varchar', nullable: true })
  postal: string;

  @Column({ type: 'varchar', nullable: true })
  address: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string;

  @Column({ type: 'enum', enum: ['user', 'teacher', 'admin'], default: 'user' })
  role: string;

  @Column({ type: 'uuid', default: '123e4567-e89b-12d3-a456-426614174000' })
  teachersRoom: string;

  @Column({ type: 'uuid', default: '123e4567-e89b-12d3-a456-426614174001' })
  generalChat: string;

  @OneToMany(() => Schedule, (schedule) => schedule.student, { nullable: true })
  studentSchedules: Schedule[];

  @OneToMany(() => Schedule, (schedule) => schedule.teacher, {
    nullable: true,
  })
  teacherSchedules: Schedule[];

  @OneToMany(() => User, (student) => student.teacher)
  students: User[];

  @ManyToOne(() => User, (teacher) => teacher.students, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'teacherId' })
  teacher: User;

  @OneToMany(() => UnreadGlobalMessage, (unreadMessage) => unreadMessage.user)
  unreadMessages: UnreadGlobalMessage[];

  @OneToOne(() => Settings, (settings) => settings.user, { 
  cascade: true,
  onDelete: 'CASCADE' 
})
settings: Settings;
}

@Entity('schedules')
export class Schedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Store the initial date and time of the event in UTC
  @Column({
    type: 'timestamp',
    transformer: {
      from: (value) => (value ? new Date(value) : null), // Ensure valid date
      to: (value) => (value instanceof Date ? value.toISOString() : null), // Handle valid Date
    },
  })
  initialDateTime: Date;

  // Store the start and end times of each occurrence in UTC
  @Column({
    type: 'timestamp',
    transformer: {
      from: (value) => (value ? new Date(value) : null), // Ensure valid date
      to: (value) => (value instanceof Date ? value.toISOString() : null), // Handle valid Date
    },
  })
  startTime: Date;

  @Column({
    type: 'timestamp',
    transformer: {
      from: (value) => (value ? new Date(value) : null), // Ensure valid date
      to: (value) => (value instanceof Date ? value.toISOString() : null), // Handle valid Date
    },
  })
  endTime: Date;

  @Column({ type: 'varchar' })
  dayOfWeek: string;

  // 1 = every week (default), 2 = every other week, etc. Existing rows have no
  // value here and TypeORM/Postgres fill them with this default (1), so old
  // schedules keep behaving exactly as before.
  @Column({ type: 'int', default: 1 })
  recurrenceWeeks: number;

  @Column({ type: 'varchar' })
  teacherName: string;

  @Column({ type: 'varchar' })
  studentName: string;

  @Column()
  studentId: string;

  @ManyToOne(() => User, (student) => student.studentSchedules, {
    nullable: false,
  })
  @ManyToOne(() => User, (student) => student.studentSchedules, {
    nullable: true,
    onDelete: 'CASCADE', // Deletes schedules when the user is deleted
  })
  @JoinColumn({ name: 'studentId' })
  student: User;

  @Column()
  teacherId: string;

  @ManyToOne(() => User, (teacher) => teacher.teacherSchedules, {
    nullable: true,
    onDelete: 'CASCADE', // Deletes schedules when the teacher is deleted
  })
  @JoinColumn({ name: 'teacherId' })
  teacher: User;

  // Explicit Jitsi room override for group classes booked from a group chat —
  // several students share one room here, so it can't be the usual implicit
  // "room = studentId" convention. Null for every normal 1:1 class (existing
  // behavior unchanged). Doubles as the link back to Conversation.id: for an
  // ordinary 1:1 DM those two ids already coincide (a DM's id is the
  // student's own userId), so setting roomId = conversation.id here is a
  // no-op for plain classes and only actually does something once a class is
  // genuinely shared by a group.
  @Column({ type: 'varchar', nullable: true })
  roomId?: string;

  // Overrides the calendar title for every viewer (teacher and every
  // student) once a class is tied to a group chat — the normal
  // studentName/teacherName split can't represent "everyone sees the same
  // title" for a 3+ person class. Null for every normal 1:1 class.
  @Column({ type: 'varchar', nullable: true })
  groupName?: string;

  // Other teachers who are members of the linked group chat but aren't the
  // owning teacher (teacherId) — they still see this class on their own
  // calendar (as a guest/co-teacher) even though there's no Schedule row of
  // their own, since a row's studentId can only ever be an actual student.
  // Kept in sync with the group's membership by
  // ConversationsRepository.syncCoTeachers — never edited directly.
  @Column({ type: 'jsonb', nullable: true })
  coTeacherIds?: string[] | null;
}
