import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { ClassSession } from './entities/class-session.entity';

@Injectable()
export class ClassSessionsService {
  constructor(
    @InjectRepository(ClassSession)
    private readonly repo: Repository<ClassSession>,
  ) {}

  async startSession(body: any) {
    // Dedup: return existing active session for same room+teacher
    const existing = await this.repo.findOne({
      where: { roomId: body.roomId, teacherId: body.teacherId, status: 'active' },
    });
    if (existing) return { sessionId: existing.id };

    // Dedup: if teacher reconnects within 30 min of a completed session in the same room,
    // reopen it (marks active again) instead of creating a duplicate counted class
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recent = await this.repo.findOne({
      where: { roomId: body.roomId, teacherId: body.teacherId, status: 'completed' },
      order: { endTime: 'DESC' },
    });
    if (recent && recent.endTime && recent.endTime >= thirtyMinAgo) {
      await this.repo.update({ id: recent.id }, { status: 'active', endTime: null, durationMinutes: null, lastHeartbeat: new Date() });
      return { sessionId: recent.id };
    }

    const session = this.repo.create({
      teacherId: body.teacherId,
      teacherName: body.teacherName,
      studentId: body.studentId || null,
      studentName: body.studentName || null,
      roomId: body.roomId,
      startTime: new Date(),
      lastHeartbeat: new Date(),
      status: 'active',
    });
    const saved = await this.repo.save(session);
    return { sessionId: saved.id };
  }

  async heartbeat(sessionId: string) {
    await this.repo.update({ id: sessionId }, { lastHeartbeat: new Date() });
    return { ok: true };
  }

  async endSession(sessionId: string, durationMinutes: number) {
    // Ignore accidental joins under 3 minutes
    if (durationMinutes < 3) {
      await this.repo.delete({ id: sessionId });
      return { ok: true, ignored: true };
    }
    await this.repo.update(
      { id: sessionId },
      { endTime: new Date(), durationMinutes, status: 'completed' },
    );
    return { ok: true };
  }

  async getAnalytics() {
    const now = new Date();
    const weekAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [weeklyData, monthlyData, weeklyCount, monthlyCount] = await Promise.all([
      // Weekly hours per teacher
      this.repo
        .createQueryBuilder('s')
        .select('s.teacherName', 'teacherName')
        .addSelect('SUM(s.durationMinutes)', 'totalMinutes')
        .where('s.status = :status', { status: 'completed' })
        .andWhere('s.startTime >= :weekAgo', { weekAgo })
        .groupBy('s.teacherName')
        .orderBy('SUM(s.durationMinutes)', 'DESC')
        .getRawMany(),

      // Monthly hours + class count per teacher
      this.repo
        .createQueryBuilder('s')
        .select('s.teacherName', 'teacherName')
        .addSelect('SUM(s.durationMinutes)', 'totalMinutes')
        .addSelect('COUNT(*)', 'classCount')
        .where('s.status = :status', { status: 'completed' })
        .andWhere('s.startTime >= :monthAgo', { monthAgo })
        .groupBy('s.teacherName')
        .orderBy('SUM(s.durationMinutes)', 'DESC')
        .getRawMany(),

      // Weekly total class count
      this.repo.count({ where: { status: 'completed', startTime: MoreThanOrEqual(weekAgo) } }),

      // Monthly total class count
      this.repo.count({ where: { status: 'completed', startTime: MoreThanOrEqual(monthAgo) } }),
    ]);

    const activeTeacherNames = new Set(monthlyData.map((r) => r.teacherName));

    return {
      weeklyHoursPerTeacher: weeklyData.map((r) => ({
        name: r.teacherName,
        hours: Math.round((parseInt(r.totalMinutes, 10) / 60) * 10) / 10,
      })),
      monthlyHoursPerTeacher: monthlyData.map((r) => ({
        name: r.teacherName,
        hours: Math.round((parseInt(r.totalMinutes, 10) / 60) * 10) / 10,
        classes: parseInt(r.classCount, 10),
      })),
      weeklyClassCount: weeklyCount,
      monthlyClassCount: monthlyCount,
      activeTeacherNames: [...activeTeacherNames],
    };
  }
}
