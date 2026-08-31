import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { MeetingLog } from './entities/meeting-log.entity';

@Injectable()
export class MeetingLogsService {
  constructor(
    @InjectRepository(MeetingLog)
    private readonly repo: Repository<MeetingLog>,
  ) {}

  // Keeps the table from growing unbounded — these are short-lived diagnostic
  // events, not records anyone needs to look up months later.
  @Cron('0 2 * * *') // daily at 2:00 AM
  async deleteOldLogs() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    await this.repo.delete({ createdAt: LessThan(thirtyDaysAgo) });
  }

  async create(body: any) {
    const entries = Array.isArray(body) ? body : [body];
    const rows = entries
      .filter((e) => e && e.event)
      .map((e) =>
        this.repo.create({
          roomId: e.roomId || null,
          userId: e.userId || null,
          userName: e.userName || null,
          email: e.email || null,
          role: e.role || null,
          event: e.event,
          level: e.level || 'info',
          detail: e.detail ? String(e.detail).slice(0, 4000) : null,
          userAgent: e.userAgent || null,
        }),
      );
    if (!rows.length) return { ok: true, saved: 0 };
    const saved = await this.repo.save(rows);
    return { ok: true, saved: saved.length };
  }

  // Used by the Jibri upload endpoint to figure out who to credit a recording
  // to when the room isn't a 1:1 class (e.g. a "Teachers Meeting" group room
  // with no single associated student to look up a teacher from).
  async findLastRecorder(roomId: string) {
    return this.repo.findOne({
      where: { roomId, event: 'recording_started' },
      order: { createdAt: 'DESC' },
    });
  }

  async find(query: any) {
    const qb = this.repo.createQueryBuilder('l').orderBy('l.createdAt', 'DESC');
    if (query.roomId) qb.andWhere('l.roomId = :roomId', { roomId: query.roomId });
    if (query.email) qb.andWhere('l.email ILIKE :email', { email: `%${query.email}%` });
    if (query.event) qb.andWhere('l.event = :event', { event: query.event });
    if (query.level) qb.andWhere('l.level = :level', { level: query.level });
    const limit = Math.min(parseInt(query.limit, 10) || 200, 500);
    qb.take(limit);
    return qb.getMany();
  }
}
