import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Schedule } from './entities/user.entity';

@Injectable()
export class ScheduleRepository {
  constructor(
    @InjectRepository(Schedule)
    private readonly repository: Repository<Schedule>,
  ) {}

  async findAll(): Promise<Schedule[]> {
    return this.repository.find();
  }

  async findByStudentId(studentId: string): Promise<Schedule[]> {
    return this.repository.find({ where: { studentId } });
  }

  async findByRoomId(roomId: string): Promise<Schedule[]> {
    return this.repository.find({ where: { roomId } });
  }

  // Used after removing specific events to check whether this pair has any
  // class left at all (across every room) — if not, the student should go
  // back to "unassigned" the same way a full removeStudentsFromTeacher does.
  async countForPair(teacherId: string, studentId: string): Promise<number> {
    return this.repository.count({ where: { teacherId, studentId } });
  }

  // A class that predates this feature (or was never grown into a group) has
  // no roomId set yet — this is how we detect "this teacher/student pair
  // already has a 1:1 class" so adding a 3rd person can extend it instead of
  // asking the teacher to pick a brand new time.
  async findLegacyOneOnOne(teacherId: string, studentId: string): Promise<Schedule[]> {
    return this.repository.find({ where: { teacherId, studentId, roomId: IsNull() } });
  }

  // Broader than findLegacyOneOnOne — any class this pair has together at
  // all, room-linked or not. Used to decide "does this teacher/student pair
  // already have a class" (e.g. before offering to schedule one from a fresh
  // DM) where a group-scheduled class — which always has a real roomId —
  // should count too, not just an unlinked legacy 1:1.
  async findAnyForPair(teacherId: string, studentId: string): Promise<Schedule[]> {
    return this.repository.find({ where: { teacherId, studentId } });
  }

  // Same idea as findLegacyOneOnOne, but checked against every CURRENT
  // member of a conversation instead of one specific person — catches "this
  // DM already represents an existing 1:1 class" even when the person being
  // added right now has never had a class with this teacher themselves.
  async findLegacyForAnyMember(teacherId: string, memberIds: string[]): Promise<Schedule[]> {
    if (!memberIds.length) return [];
    return this.repository.find({ where: { teacherId, studentId: In(memberIds), roomId: IsNull() } });
  }

  // Classes where this teacher isn't the owner (teacherId) but is listed as
  // a co-teacher/guest — jsonb containment, so it needs a raw query builder
  // condition rather than a plain `where`.
  async findCoTeaching(teacherId: string): Promise<Schedule[]> {
    return this.repository
      .createQueryBuilder('s')
      .where(`s."coTeacherIds" @> :id::jsonb`, { id: JSON.stringify([teacherId]) })
      .getMany();
  }

  // Recomputes/persists coTeacherIds for every row sharing a room — used
  // whenever group membership changes so the set stays exactly "current
  // teacher members minus whoever owns the class."
  async setCoTeachers(roomId: string, coTeacherIds: string[]): Promise<Schedule[]> {
    await this.repository.update({ roomId }, { coTeacherIds: coTeacherIds.length ? coTeacherIds : null });
    return this.repository.find({ where: { roomId } });
  }

  async createGroupSchedule(params: {
    teacherId: string;
    teacherName: string;
    students: { id: string; name: string }[];
    roomId: string;
    groupName?: string;
    initialDateTime: Date;
    startTime: Date;
    endTime: Date;
    dayOfWeek: string;
    recurrenceWeeks: number;
  }): Promise<Schedule[]> {
    const rows = params.students.map((student) => ({
      teacherId: params.teacherId,
      teacherName: params.teacherName,
      studentId: student.id,
      studentName: student.name,
      roomId: params.roomId,
      groupName: params.groupName ?? null,
      initialDateTime: params.initialDateTime,
      startTime: params.startTime,
      endTime: params.endTime,
      dayOfWeek: params.dayOfWeek,
      recurrenceWeeks: params.recurrenceWeeks,
    }));
    return this.repository.save(rows);
  }

  // Clones every existing slot shared by a room (a teacher can have more than
  // one weekly slot with the same group) for a newly-added student. If the
  // room was only ever implicit (a legacy 1:1 never explicitly linked), the
  // caller backfills roomId onto those rows first — see UsersService.
  async extendToMember(roomId: string, student: { id: string; name: string }): Promise<Schedule[]> {
    const existing = await this.findByRoomId(roomId);
    // Confirming "add to class" twice for the same student (e.g. once via
    // the mention picker, once later via Add People) must not double-book
    // them — skip any template slot they already hold in this room.
    const heldSlots = new Set(
      existing
        .filter((row) => row.studentId === student.id)
        .map((row) => `${row.startTime?.toISOString()}|${row.dayOfWeek}`)
    );
    const clones = existing
      .filter((row) => row.studentId !== student.id)
      .filter((row) => !heldSlots.has(`${row.startTime?.toISOString()}|${row.dayOfWeek}`))
      .map((row) => ({
        teacherId: row.teacherId,
        teacherName: row.teacherName,
        studentId: student.id,
        studentName: student.name,
        roomId: row.roomId,
        groupName: row.groupName,
        initialDateTime: row.initialDateTime,
        startTime: row.startTime,
        endTime: row.endTime,
        dayOfWeek: row.dayOfWeek,
        recurrenceWeeks: row.recurrenceWeeks,
      }));
    if (!clones.length) return [];
    return this.repository.save(clones);
  }

  async backfillRoomId(teacherId: string, studentId: string, roomId: string): Promise<void> {
    await this.repository.update({ teacherId, studentId, roomId: IsNull() }, { roomId });
  }

  // Same as backfillRoomId, but for every current member of the room at
  // once — needed because the person we're extending FOR isn't necessarily
  // the one whose legacy row needs tagging (e.g. adding a guest teacher to a
  // room where the *existing* student's class was never linked).
  async backfillRoomIdForMembers(teacherId: string, memberIds: string[], roomId: string): Promise<void> {
    if (!memberIds.length) return;
    await this.repository.update({ teacherId, studentId: In(memberIds), roomId: IsNull() }, { roomId });
  }

  async renameByRoomId(roomId: string, groupName: string): Promise<void> {
    await this.repository.update({ roomId }, { groupName });
  }

  async removeMemberRows(roomId: string, studentId: string): Promise<string[]> {
    const rows = await this.repository.find({ where: { roomId, studentId } });
    if (!rows.length) return [];
    await this.repository.delete({ roomId, studentId });
    return rows.map((r) => r.id);
  }

  async deleteByRoomId(roomId: string): Promise<Schedule[]> {
    const rows = await this.repository.find({ where: { roomId } });
    if (rows.length) await this.repository.delete({ roomId });
    return rows;
  }

  async save(schedule: Schedule): Promise<Schedule> {
    return this.repository.save(schedule);
  }

  async modifySchedule(body: any): Promise<Schedule> {
    const { eventId, start, end, newEvent } = body;
    const schedule = await this.repository.findOne({ where: { id: eventId } });
    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }
    const newStart = new Date(start);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    schedule.startTime = newStart;
    schedule.endTime = new Date(end);
    schedule.initialDateTime = new Date(newEvent);
    schedule.dayOfWeek = dayNames[newStart.getUTCDay()];

    return await this.repository.save(schedule);
  }
  // Returns the rows actually deleted (not just a boolean) so the caller can
  // see which room(s) they belonged to — needed to check whether any of
  // those rooms are now fully unlinked (see UsersService.removeEvents).
  async removeEvents(body: {
    eventIds: string[];
    teacherId: string;
    studentId: string;
  }): Promise<Schedule[]> {
    const { eventIds, teacherId, studentId } = body;
    // `IN (:...eventIds)` with an empty array produces invalid SQL ("IN ()"), which
    // Postgres rejects with a syntax error — reachable from the UI by confirming the
    // remove-events modal with no events checked and "remove all" left unticked.
    if (!eventIds || eventIds.length === 0) {
      throw new BadRequestException('No event IDs provided');
    }
    const rows = await this.repository.find({
      where: { id: In(eventIds), teacherId, studentId },
    });
    if (!rows.length) {
      throw new NotFoundException('Events not found');
    }
    await this.repository.delete(rows.map((row) => row.id));
    return rows;
  }
}
