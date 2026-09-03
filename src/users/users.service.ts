import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { ScheduleRepository } from './schedule.repository';
import { VideoCallsGateway } from 'src/videocalls.gateaway';
import { ConversationsService } from 'src/conversations/conversations.service';
import { Schedule } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly scheduleRepository: ScheduleRepository,
    private readonly gateway: VideoCallsGateway,
    private readonly conversationsService: ConversationsService,
  ) {}

  private async requireTeacher(teacherId: string) {
    const teacher = await this.usersRepository.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      throw new ForbiddenException('Only a teacher can schedule a class');
    }
    return teacher;
  }

  // Never let a non-student (another teacher, an admin) end up as a Schedule
  // row's studentId — that row would be permanently invisible to them (their
  // own calendar only ever reads rows keyed by their id as *teacherId*), and
  // scheduling is only meant to model a teacher/student relationship anyway.
  // Silently drops anyone who isn't role:'user' rather than failing the
  // whole request over a mixed-role member list.
  private async filterToStudents<T extends { id: string }>(candidates: T[]): Promise<T[]> {
    if (!candidates.length) return [];
    const users = await this.usersRepository.findByIds(candidates.map((c) => c.id));
    const studentIds = new Set(users.filter((u) => u.role === 'user').map((u) => u.id));
    return candidates.filter((c) => studentIds.has(c.id));
  }

  async findAll() {
    const users = await this.usersRepository.findAll();
    if (!users || users.length === 0) {
      throw new NotFoundException('No users found');
    }
    return users;
  }

  async findAdminDashboard() {
    return this.usersRepository.findAdminDashboard();
  }

  async assignStudent(body: any) {
    const result = await this.usersRepository.assignStudent(body);
    if (!result) {
      throw new NotFoundException('User not found');
    }
    this.gateway.notifyStudentAssigned({
      teacherId: result.teacherId,
      studentId: result.studentId,
      schedules: result.savedSchedules,
      student: result.student,
      teacher: result.teacher,
    });
    return result;
  }

  async remove(email: string) {
    const removedUser = await this.usersRepository.remove(email);
    if (!removedUser.affected) {
      throw new NotFoundException('User not found');
    }
    return removedUser;
  }

  async update(updateUser: any) {
    const updatedUser = await this.usersRepository.update(updateUser);
    if (!updatedUser.affected) {
      throw new NotFoundException('User not found');
    }
    return updatedUser;
  }

  async removeStudentsFromTeacher(body: any) {
    const result = await this.usersRepository.removeStudentsFromTeacher(body);
    if (!result) {
      throw new NotFoundException('Schedule not found');
    }
    this.gateway.notifyStudentRemoved({
      teacherId: result.teacherId,
      studentIds: result.studentIds,
      deletedScheduleIds: result.deletedScheduleIds,
    });
    return result;
  }

  async modifySchedule(body: any) {
    const updatedSchedule = await this.scheduleRepository.modifySchedule(body);
    if (!updatedSchedule) {
      throw new NotFoundException('Schedule not found');
    }
    this.gateway.notifyScheduleUpdated({
      studentId: updatedSchedule.studentId,
      action: 'modify',
      schedule: updatedSchedule,
    });
    return updatedSchedule;
  }

  async removeEvents(body: {
    eventIds: string[];
    teacherId: string;
    studentId: string;
  }) {
    const success = await this.scheduleRepository.removeEvents(body);
    if (!success) {
      throw new NotFoundException('Events not found');
    }
    this.gateway.notifyScheduleUpdated({
      studentId: body.studentId,
      action: 'remove',
      eventIds: body.eventIds,
    });
    return 'success';
  }

  async getStudentSchedules(studentId: string) {
    return this.scheduleRepository.findByStudentId(studentId);
  }

  async getStudentProfile(studentId: string) {
    const user = await this.usersRepository.findById(studentId);
    if (!user) throw new NotFoundException('Student not found');
    return {
      teacher: user.teacher
        ? {
            id: user.teacher.id,
            name: user.teacher.name,
            lastName: user.teacher.lastName,
            email: user.teacher.email,
            avatarUrl: user.teacher.avatarUrl,
            role: user.teacher.role,
          }
        : null,
      studentSchedules: user.studentSchedules,
    };
  }

  // Mirrors getStudentProfile — lets a teacher refetch their own schedules on
  // demand (e.g. on the Schedule page mounting) instead of only ever seeing
  // whatever was loaded at login plus whatever live socket events happened
  // to arrive while that page was open.
  async getTeacherProfile(teacherId: string) {
    const user = await this.usersRepository.findById(teacherId);
    if (!user) throw new NotFoundException('Teacher not found');
    // Classes this teacher owns (teacherId) plus classes they're a
    // co-teacher/guest on (coTeacherIds) — the relation used above only
    // ever covers the former.
    const coTeaching = await this.scheduleRepository.findCoTeaching(teacherId);
    return { teacherSchedules: [...(user.teacherSchedules || []), ...coTeaching] };
  }

  async getAdminStats() {
    return this.usersRepository.getAdminStats();
  }

  async getAnalytics() {
    return this.usersRepository.getAnalytics();
  }

  async findTeachers() {
    return this.usersRepository.findTeachers();
  }

  async findStudentsPaginated(params: {
    page: number;
    limit: number;
    search?: string;
    language?: string;
    unassignedOnly?: boolean;
  }) {
    return this.usersRepository.findStudentsPaginated(params);
  }

  async searchUsers(params: {
    query: string;
    excludeUserId?: string;
    limit?: number;
  }) {
    return this.usersRepository.searchUsers(params);
  }

  async getPublicProfile(id: string) {
    return this.usersRepository.getPublicProfile(id);
  }

  async addEvent(event: any) {
    const newEvent = {
      ...event,
      initialDateTime: new Date(event.initialDateTime),
      startTime: new Date(event.startTime),
      endTime: new Date(event.endTime),
    };
    const savedSchedule = await this.scheduleRepository.save(newEvent);
    if (!savedSchedule) {
      throw new NotFoundException('Failed to create event');
    }
    this.gateway.notifyScheduleUpdated({
      studentId: savedSchedule.studentId,
      action: 'add',
      schedule: savedSchedule,
    });
    return savedSchedule;
  }

  // Turns a group chat into a real recurring class. Only reachable by the
  // teacher (checked here, not just hidden in the UI) since a class touches
  // every member's calendar. roomId is set to the conversation's own id —
  // see the comment on Schedule.roomId for why that's a safe, meaningful key.
  async scheduleGroup(body: {
    teacherId: string;
    teacherName: string;
    students: { id: string; name: string }[];
    conversationId: string;
    groupName: string;
    initialDateTime: string;
    startTime: string;
    endTime: string;
    dayOfWeek: string;
    recurrenceWeeks?: number;
  }) {
    await this.requireTeacher(body.teacherId);
    const students = await this.filterToStudents(body.students || []);
    if (!students.length) {
      throw new NotFoundException('At least one student is required');
    }

    const savedSchedules = await this.scheduleRepository.createGroupSchedule({
      teacherId: body.teacherId,
      teacherName: body.teacherName,
      students,
      roomId: body.conversationId,
      groupName: body.groupName,
      initialDateTime: new Date(body.initialDateTime),
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
      dayOfWeek: body.dayOfWeek,
      recurrenceWeeks: body.recurrenceWeeks || 1,
    });

    // Also sets the conversation's own name (and nameIsCustom, via
    // renameGroup) to the chosen class name — without this, the conversation
    // keeps whatever name it had before scheduling, and the very next
    // addMember call (nameIsCustom still false) auto-recomputes the group's
    // display name from its member list and overwrites this Schedule row's
    // groupName right back to that generic name, silently clobbering the
    // class name the teacher just deliberately chose.
    await this.conversationsService.renameGroup(body.conversationId, {
      linkedToSchedule: true,
      name: body.groupName,
    });
    // Picks up any teachers who were already members of this group before it
    // got scheduled — they see the class on their own calendar too now.
    await this.conversationsService.syncCoTeachers(body.conversationId);
    // A student with no assigned teacher yet is now assigned to this one —
    // otherwise they'd keep showing up as "unassigned" in the admin panel
    // despite having an active class.
    await this.usersRepository.assignTeacherIfUnassigned(body.teacherId, students.map((s) => s.id));

    savedSchedules.forEach((schedule) => {
      this.gateway.notifyScheduleUpdated({ studentId: schedule.studentId, action: 'add', schedule });
    });

    return { schedules: savedSchedules };
  }

  // Does this teacher/student pair (or this conversation, once explicitly
  // linked) already have a class? Checked before offering "add to my
  // existing class" vs. "pick a new time" when a teacher adds a member.
  async getScheduleLink(params: { teacherId: string; otherUserId: string; conversationId?: string }) {
    let rows = params.conversationId
      ? await this.scheduleRepository.findByRoomId(params.conversationId)
      : [];
    // The room itself might already represent someone ELSE's existing
    // legacy class — e.g. a teacher's long-standing 1:1 DM with Student A
    // (never explicitly "linked") gains a 2nd person; neither A's row nor
    // the new person's own pair has a roomId yet, so check every current
    // member, not just the person being added.
    if (!rows.length && params.conversationId) {
      const memberIds = await this.conversationsService.getMemberIds(params.conversationId);
      const otherMemberIds = memberIds.filter((id) => id !== params.teacherId);
      if (otherMemberIds.length) {
        rows = await this.scheduleRepository.findLegacyForAnyMember(params.teacherId, otherMemberIds);
      }
    }
    if (!rows.length) {
      rows = await this.scheduleRepository.findLegacyOneOnOne(params.teacherId, params.otherUserId);
    }
    // Catches a class this pair already has via some OTHER group's room —
    // findLegacyOneOnOne alone only sees never-linked (roomId IS NULL)
    // classes, so a class scheduled through a group would otherwise be
    // missed here and get offered again from a fresh 1:1 DM. Only applied
    // when the caller has no conversationId of their own (the "opening a
    // fresh DM" check) — when adding a member to a *specific* group,
    // discovering this pair has an unrelated class elsewhere must NOT make
    // that other group's roomId get returned here, or "add to class" would
    // wire the new member into the wrong class entirely.
    if (!rows.length && !params.conversationId) {
      rows = await this.scheduleRepository.findAnyForPair(params.teacherId, params.otherUserId);
    }
    if (!rows.length) return { linked: false };
    return { linked: true, roomId: rows[0].roomId || params.conversationId, groupName: rows[0].groupName || null };
  }

  // Adds a new person to an already-existing class at its EXISTING time
  // slot (the "1:1 event that already has a teacher and student gains a
  // third person" case) — a student gets their own Schedule row (cloned
  // from the existing slot); a teacher/admin guest gets no row of their own
  // and instead rides along as a coTeacherId, same as any teacher who was
  // already a member when the class was first scheduled.
  //
  // Backfills roomId onto every current member's legacy (never-linked) row
  // the first time this room is extended — not just the person being added
  // right now — so a plain, never-grouped 1:1 class becomes a properly
  // linked group class going forward regardless of which side triggered it.
  async extendScheduleGroup(
    roomId: string,
    body: { teacherId: string; personId: string; personName: string; groupName?: string },
  ) {
    await this.requireTeacher(body.teacherId);
    const target = await this.usersRepository.findById(body.personId);
    if (!target) {
      throw new NotFoundException('Person not found');
    }

    const memberIds = await this.conversationsService.getMemberIds(roomId);
    const otherMemberIds = memberIds.filter((id) => id !== body.teacherId);
    if (otherMemberIds.length) {
      await this.scheduleRepository.backfillRoomIdForMembers(body.teacherId, otherMemberIds, roomId);
    }

    if (body.groupName) {
      await this.scheduleRepository.renameByRoomId(roomId, body.groupName);
    }

    let newRows: Schedule[] = [];
    if (target.role === 'user') {
      await this.scheduleRepository.backfillRoomId(body.teacherId, body.personId, roomId);
      newRows = await this.scheduleRepository.extendToMember(roomId, {
        id: body.personId,
        name: body.personName,
      });
      if (!newRows.length) {
        throw new NotFoundException('No existing class found to extend for this room');
      }
      await this.usersRepository.assignTeacherIfUnassigned(body.teacherId, [body.personId]);
    } else {
      // Teacher/admin guest: no Schedule row of their own — just make sure
      // they're actually a member of the room so syncCoTeachers below picks
      // them up. No-ops if they're already a member.
      await this.conversationsService.addMember(roomId, body.personId, {
        addedBy: body.teacherId,
        shareHistory: true,
      });
    }

    // When a name was chosen, this also broadcasts a live 'modify' to every
    // existing member's calendar (see ConversationsRepository.renameGroup /
    // broadcastRoomRename) — only the brand new student's rows still need an
    // explicit push here, since they don't exist on anyone's client yet.
    await this.conversationsService.renameGroup(roomId, {
      linkedToSchedule: true,
      ...(body.groupName ? { name: body.groupName } : {}),
    });
    await this.conversationsService.syncCoTeachers(roomId);

    newRows.forEach((schedule) => {
      this.gateway.notifyScheduleUpdated({ studentId: schedule.studentId, action: 'add', schedule });
    });

    return { schedules: newRows };
  }
}
