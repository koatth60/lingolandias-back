import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(['status', 'startTime'])
@Entity()
export class ClassSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  teacherId: string;

  @Column()
  teacherName: string;

  @Column({ nullable: true })
  studentId: string;

  @Column({ nullable: true })
  studentName: string;

  @Column()
  roomId: string;

  @Column({ type: 'timestamp with time zone' })
  startTime: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  endTime: Date;

  @Column({ type: 'int', nullable: true })
  durationMinutes: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastHeartbeat: Date;

  @Column({
    type: 'enum',
    enum: ['active', 'completed', 'abandoned'],
    default: 'active',
  })
  status: string;
}
