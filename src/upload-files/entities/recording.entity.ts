import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Tracks recordings by real id instead of parsing S3 folder/file names — lets
// teachers/students query "my recordings" precisely instead of guessing from
// filenames (which breaks down e.g. when two students share a first name).
@Index(['teacherId', 'studentId'])
@Entity('recordings')
export class Recording {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ nullable: true })
  teacherId: string;

  @Column({ nullable: true })
  teacherName: string;

  @Column({ nullable: true })
  teacherEmail: string;

  @Index()
  @Column({ nullable: true })
  studentId: string;

  @Column({ nullable: true })
  studentName: string;

  @Column({ nullable: true })
  roomId: string;

  @Column()
  s3Key: string;

  @Column()
  filename: string;

  @Column({ type: 'bigint', nullable: true })
  sizeBytes: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;
}
