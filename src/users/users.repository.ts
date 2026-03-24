import { Injectable } from '@nestjs/common';
import { Schedule, User } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
// import { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UnreadGlobalMessage } from 'src/chat/entities/unread-global-messages.entity';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    @InjectRepository(Schedule)
    private readonly scheduleRepository: Repository<Schedule>,

    @InjectRepository(UnreadGlobalMessage)
    private readonly unReadGlobalMessageRepo: Repository<UnreadGlobalMessage>,
  ) {}

  async findByEmail(email: string): Promise<User | undefined> {
    return await this.usersRepository.findOne({
      where: { email },
      relations: [
        'students',
        'teacher',
        'studentSchedules',
        'teacherSchedules',
        'settings',
      ],
    });
  }

  async findById(id: string): Promise<User | undefined> {
    return await this.usersRepository.findOne({
      where: { id },
      relations: [
        'students',
        'teacher',
        'studentSchedules',
        'teacherSchedules',
        'settings',
      ],
    });
  }

  async register(newUser: User): Promise<User> {
    return this.usersRepository.save(newUser);
  }

  async login(email: string, password: string): Promise<User | undefined> {
    const user = await this.usersRepository.findOne({
      where: { email },
      relations: [
        'students',
        'teacher',
        'studentSchedules',
        'teacherSchedules',
        'settings',
      ],
    });
    if (user && (await bcrypt.compare(password, user.password))) {
      return user;
    }
    return undefined;
  }
  async save(user: User): Promise<User> {
    return await this.usersRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    const users = await this.usersRepository.find({
      relations: [
        'students',
        'teacher',
        'studentSchedules',
        'teacherSchedules',
        'settings',
      ],
    });

    return users;
  }

  // Lean query for admin dashboard: users without heavy relations + all schedules
  async findAdminDashboard(): Promise<{ users: User[]; schedules: Schedule[] }> {
    const [users, schedules] = await Promise.all([
      this.usersRepository.find({ relations: ['settings', 'teacher'] }),
      this.scheduleRepository.find(),
    ]);
    return { users, schedules };
  }

  // Reset all users to offline (called on server startup)
  async resetAllOnlineStatus(): Promise<void> {
    await this.usersRepository.update({}, { online: 'offline' } as any);
  }

  async assignStudent(body: any): Promise<any> {
    const { teacherId, studentId, events } = body;

    const teacher = await this.usersRepository.findOne({
      where: { id: teacherId },
      relations: ['students', 'teacherSchedules'],
    });

    const student = await this.usersRepository.findOne({
      where: { id: studentId },
      relations: ['teacher', 'studentSchedules'],
    });

    if (!teacher || teacher.role !== 'teacher') {
      throw new Error('Teacher not found.');
    }
    if (!student || student.role !== 'user') {
      throw new Error('Student not found.');
    }

    teacher.students.push(student);
    student.teacher = teacher;

    // Ensure the `initialDateTime` field is populated
    const updatedEvents = events.map((event) => ({
      ...event,
      student,
      teacher,
      studentId,
      teacherId,
      startTime: new Date(event.start), // Save UTC start time
      endTime: new Date(event.end), // Save UTC end time
      initialDateTime: new Date(event.start), // Ensure this is populated as well
    }));

    const savedSchedules = await this.scheduleRepository.save(updatedEvents);
    teacher.teacherSchedules = [...teacher.teacherSchedules, ...savedSchedules];
    student.studentSchedules = [...student.studentSchedules, ...savedSchedules];

    await this.usersRepository.save(teacher);
    await this.usersRepository.save(student);

    // Strip relation objects from saved schedules to avoid circular-reference
    // errors when socket.io tries to JSON-serialize the payload.
    const plainSchedules = savedSchedules.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      initialDateTime: s.initialDateTime,
      dayOfWeek: s.dayOfWeek,
      studentId: s.studentId,
      teacherId: s.teacherId,
      studentName: s.studentName,
      teacherName: s.teacherName,
    }));

    return {
      message: 'Teacher and student updated successfully with schedules',
      savedSchedules: plainSchedules,
      studentId,
      teacherId,
      student: {
        id: student.id,
        name: student.name,
        lastName: student.lastName,
        email: student.email,
        avatarUrl: student.avatarUrl,
        role: student.role,
      },
      teacher: {
        id: teacher.id,
        name: teacher.name,
        lastName: teacher.lastName,
        email: teacher.email,
        avatarUrl: teacher.avatarUrl,
        role: teacher.role,
      },
    };
  }

  async remove(email: string): Promise<any> {
    const user = await this.usersRepository.findOne({ where: { email } });

    if (!user) {
      return 'no user found';
    }
    await this.unReadGlobalMessageRepo.delete({
      user: { id: user.id },
    });
    const deletedUser = await this.usersRepository.delete({ email });
    return deletedUser;
  }

  async update(updateUser: any): Promise<any> {
    const { email, ...rest } = updateUser;

    const updatedUser = await this.usersRepository.update({ email }, rest);

    if (!updatedUser.affected) {
      return 'no user found';
    }
    return updatedUser;
  }

  async updateUserProfileImage(
    userId: string,
    imageUrl: string,
  ): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: [
        'students',
        'teacher',
        'studentSchedules',
        'teacherSchedules',
        'settings',
      ],
    });

    if (!user) {
      throw new Error('User not found');
    }

    user.avatarUrl = imageUrl;

    const updatedUser = await this.usersRepository.save(user);
    return updatedUser;
  }

  async removeStudentsFromTeacher(body: any): Promise<any> {
    const { teacherId, studentIds } = body;

    // Fetch the teacher with necessary relations
    const teacher = await this.usersRepository.findOne({
      where: { id: teacherId },
      relations: ['students', 'teacherSchedules'],
    });

    if (!teacher || teacher.role !== 'teacher') {
      throw new Error('Teacher not found.');
    }

    // Fetch all the students to be removed
    const students = await this.usersRepository.find({
      where: { id: In(studentIds) },
      relations: ['studentSchedules'],
    });

    if (!students || students.length === 0) {
      throw new Error('No students found.');
    }

    // Try to remove schedules related to the teacher and the students
    const deleteResult = await this.scheduleRepository.find({
      where: {
        teacherId: teacher.id,
        studentId: In(studentIds), // Ensure both teacherId and studentId are in the same schedule
      },
    });
    const idsToDelete = deleteResult.map((schedule) => schedule.id); // Get all the IDs to delete
    if (idsToDelete.length > 0) {
      await this.scheduleRepository.delete(idsToDelete); // Directly delete by IDs
    }
    // else {
    //   throw new Error('No schedules found to delete.');
    // }
    // If no schedules were deleted, throw an error and stop further execution
    // if (deleteResult.affected === 0) {
    //   throw new Error('No schedules were deleted. Rolling back.');
    // }

    // Remove each student from the teacher's students array
    teacher.students = teacher.students.filter(
      (student) => !studentIds.includes(student.id),
    );

    // Remove the teacher reference from each student's teacher field
    students.forEach((student) => {
      student.teacher = null;
    });

    // Save updated teacher and students
    await this.usersRepository.save(teacher);
    await this.usersRepository.save(students);

    return {
      message:
        'Students removed from teacher successfully, and schedules deleted.',
      deletedScheduleIds: idsToDelete,
      teacherId,
      studentIds,
    };
  }

  async find() {
    return await this.usersRepository.find();
  }

  async getAdminStats(): Promise<{ teacherCount: number; studentCount: number; unassignedCount: number }> {
    const [teacherCount, studentCount, unassignedCount] = await Promise.all([
      this.usersRepository.count({ where: { role: 'teacher' } }),
      this.usersRepository.count({ where: { role: 'user' } }),
      this.usersRepository
        .createQueryBuilder('user')
        .leftJoin('user.teacher', 't')
        .where('user.role = :role', { role: 'user' })
        .andWhere('t.id IS NULL')
        .getCount(),
    ]);
    return { teacherCount, studentCount, unassignedCount };
  }

  async findTeachers(): Promise<User[]> {
    return this.usersRepository.find({
      where: { role: 'teacher' },
      relations: ['students', 'teacherSchedules'],
    });
  }

  async getAnalytics(): Promise<any> {
    const [studentsPerTeacher, languageDistribution, schedulesPerTeacher] = await Promise.all([
      // Students count per teacher
      this.usersRepository
        .createQueryBuilder('teacher')
        .select(['teacher.id', 'teacher.name', 'teacher.lastName'])
        .addSelect('COUNT(student.id)', 'studentCount')
        .leftJoin('teacher.students', 'student')
        .where('teacher.role = :role', { role: 'teacher' })
        .groupBy('teacher.id')
        .addGroupBy('teacher.name')
        .addGroupBy('teacher.lastName')
        .orderBy('"studentCount"', 'DESC')
        .getRawMany(),

      // Students by language
      this.usersRepository
        .createQueryBuilder('user')
        .select('user.language', 'language')
        .addSelect('COUNT(*)', 'count')
        .where('user.role = :role', { role: 'user' })
        .groupBy('user.language')
        .getRawMany(),

      // Schedule slots per teacher
      this.scheduleRepository
        .createQueryBuilder('schedule')
        .select('schedule.teacherName', 'teacherName')
        .addSelect('COUNT(*)', 'count')
        .groupBy('schedule.teacherName')
        .orderBy('"count"', 'DESC')
        .getRawMany(),
    ]);

    return {
      studentsPerTeacher: studentsPerTeacher.map((r) => ({
        name: `${r.teacher_name} ${r.teacher_lastName}`,
        count: parseInt(r.studentCount, 10),
      })),
      languageDistribution: languageDistribution.map((r) => ({
        language: r.language || 'unknown',
        count: parseInt(r.count, 10),
      })),
      schedulesPerTeacher: schedulesPerTeacher.map((r) => ({
        name: r.teacherName || 'Unknown',
        count: parseInt(r.count, 10),
      })),
    };
  }

  async findStudentsPaginated(params: {
    page: number;
    limit: number;
    search?: string;
    language?: string;
    unassignedOnly?: boolean;
  }): Promise<{ data: Partial<User>[]; total: number; page: number; totalPages: number }> {
    const { page = 1, limit = 20, search, language, unassignedOnly } = params;

    const qb = this.usersRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.name',
        'user.lastName',
        'user.email',
        'user.language',
        'user.avatarUrl',
      ])
      .where('user.role = :role', { role: 'user' });

    if (unassignedOnly) {
      qb.leftJoin('user.teacher', 'teacher').andWhere('teacher.id IS NULL');
    }

    if (search?.trim()) {
      qb.andWhere(
        '(LOWER(user.name) LIKE :search OR LOWER(user.lastName) LIKE :search OR LOWER(user.email) LIKE :search)',
        { search: `%${search.trim().toLowerCase()}%` },
      );
    }

    if (language?.trim()) {
      qb.andWhere('user.language = :language', { language: language.trim() });
    }

    const [data, total] = await qb
      .orderBy('user.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }
}
