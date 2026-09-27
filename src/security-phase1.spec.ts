import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TrelloController } from './trello/trello.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * Regression tests for the 2026-09-27 authorization fixes ("Fase 1"). Each
 * block pins down a route that checked login but not role or ownership.
 */

describe('TrelloController — ownership', () => {
  const OWNER = 'owner-1';
  const OTHER = 'other-2';

  const makeController = (role: string) => {
    const trelloService: any = {
      getBoardOwnerId: jest.fn().mockResolvedValue(OWNER),
      getListOwnerId: jest.fn().mockResolvedValue(OWNER),
      getCardOwnerId: jest.fn().mockResolvedValue(OWNER),
      getUserRole: jest.fn().mockResolvedValue(role),
      updateBoard: jest.fn().mockResolvedValue({ id: 'b1' }),
      deleteBoard: jest.fn(),
      getBoardsByUser: jest.fn().mockResolvedValue([]),
      createBoard: jest.fn().mockResolvedValue({ id: 'b1' }),
      updateList: jest.fn().mockResolvedValue({ id: 'l1' }),
      deleteCard: jest.fn(),
    };
    const controller = new TrelloController(trelloService, {} as any);
    return { controller, trelloService };
  };

  it('refuses a non-owner, non-admin from updating a board', async () => {
    const { controller } = makeController('teacher');
    await expect(controller.updateBoard('b1', { name: 'x' }, OTHER)).rejects.toThrow(ForbiddenException);
  });

  it('lets the owner update their own board', async () => {
    const { controller, trelloService } = makeController('teacher');
    await controller.updateBoard('b1', { name: 'x' }, OWNER);
    expect(trelloService.updateBoard).toHaveBeenCalled();
  });

  it('lets an admin act on a board they do not own', async () => {
    const { controller, trelloService } = makeController('admin');
    await controller.deleteBoard('b1', OTHER);
    expect(trelloService.deleteBoard).toHaveBeenCalledWith('b1');
  });

  it('refuses a non-owner from deleting a card', async () => {
    const { controller } = makeController('teacher');
    await expect(controller.deleteCard('c1', OTHER)).rejects.toThrow(ForbiddenException);
  });

  it('404s when the board does not exist rather than leaking a 403', async () => {
    const { controller, trelloService } = makeController('teacher');
    trelloService.getBoardOwnerId.mockResolvedValue(null);
    await expect(controller.updateBoard('missing', {}, OTHER)).rejects.toThrow(NotFoundException);
  });

  it('refuses listing another user\'s boards', async () => {
    const { controller } = makeController('teacher');
    await expect(controller.getBoards(OTHER, OWNER)).rejects.toThrow(ForbiddenException);
  });

  it('creates a board for the caller, ignoring any userId in the body', async () => {
    const { controller, trelloService } = makeController('teacher');
    await controller.createBoard('My board', '#000', 'Inter', '', OWNER);
    expect(trelloService.createBoard).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER }),
    );
  });
});

describe('UsersController — teacher-acting-alone routes', () => {
  const makeController = (role: string | null) => {
    const usersService: any = {
      getRole: jest.fn().mockResolvedValue(role),
      addEvent: jest.fn().mockResolvedValue({ id: 'e1' }),
      removeStudentsFromTeacher: jest.fn().mockResolvedValue({}),
      scheduleGroup: jest.fn().mockResolvedValue({}),
    };
    return { controller: new UsersController(usersService), usersService };
  };

  it('refuses add-event when the body names a different teacher', async () => {
    const { controller } = makeController('teacher');
    await expect(
      controller.addEvent({ teacherId: 'other-teacher' }, 'me'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows add-event when the teacher acts for themself', async () => {
    const { controller, usersService } = makeController('teacher');
    await controller.addEvent({ teacherId: 'me' }, 'me');
    expect(usersService.addEvent).toHaveBeenCalled();
  });

  it('allows an admin to act as any teacher (admin panel flows)', async () => {
    const { controller, usersService } = makeController('admin');
    await controller.removeStudentsFromTeacher({ teacherId: 'some-teacher' }, 'admin-1');
    expect(usersService.removeStudentsFromTeacher).toHaveBeenCalled();
  });
});

describe('UsersService — modifySchedule ownership', () => {
  const makeService = (schedule: any, role: string | null) => {
    const scheduleRepository = {
      findById: jest.fn().mockResolvedValue(schedule),
      modifySchedule: jest.fn().mockResolvedValue({ id: 'row-1' }),
    };
    const usersRepository = { findById: jest.fn().mockResolvedValue(role ? { role } : null) };
    const service = Object.create(UsersService.prototype);
    Object.assign(service, {
      scheduleRepository,
      usersRepository,
      gateway: { notifyScheduleUpdated: jest.fn() },
    });
    return { service: service as UsersService, scheduleRepository };
  };

  it('refuses a teacher modifying another teacher\'s class', async () => {
    const { service } = makeService({ id: 'row-1', teacherId: 'teacher-A' }, 'teacher');
    await expect(service.modifySchedule({ eventId: 'row-1' }, 'teacher-B')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets the owning teacher modify their own class', async () => {
    const { service, scheduleRepository } = makeService({ id: 'row-1', teacherId: 'teacher-A' }, 'teacher');
    await service.modifySchedule({ eventId: 'row-1' }, 'teacher-A');
    expect(scheduleRepository.modifySchedule).toHaveBeenCalled();
  });

  it('lets an admin modify any class', async () => {
    const { service, scheduleRepository } = makeService({ id: 'row-1', teacherId: 'teacher-A' }, 'admin');
    await service.modifySchedule({ eventId: 'row-1' }, 'admin-1');
    expect(scheduleRepository.modifySchedule).toHaveBeenCalled();
  });

  it('404s for a non-existent event', async () => {
    const { service } = makeService(null, 'teacher');
    await expect(service.modifySchedule({ eventId: 'gone' }, 'anyone')).rejects.toThrow(NotFoundException);
  });
});

describe('UsersService — getTeacherProfile anonymizes other students for non-owners', () => {
  const makeService = () => {
    const rows = [{ id: 'r1', studentId: 's1', studentName: 'Real Name', startTime: 't', student: {} }];
    const usersRepository = {
      findById: jest.fn((id: string) =>
        id === 'teacher-1'
          ? Promise.resolve({ id: 'teacher-1', teacherSchedules: rows })
          : Promise.resolve({ id, role: id === 'admin-1' ? 'admin' : 'user' }),
      ),
    };
    const scheduleRepository = { findCoTeaching: jest.fn().mockResolvedValue([]) };
    const service = Object.create(UsersService.prototype);
    Object.assign(service, { usersRepository, scheduleRepository });
    return service as UsersService;
  };

  it('strips studentName/studentId for a caller who is not the teacher or an admin', async () => {
    const service = makeService();
    const result = await service.getTeacherProfile('teacher-1', 'some-other-user');
    expect(result.teacherSchedules[0].studentName).toBeUndefined();
    expect(result.teacherSchedules[0].studentId).toBeUndefined();
    expect(result.teacherSchedules[0].id).toBe('r1');
  });

  it('keeps the real data for the teacher themself', async () => {
    const service = makeService();
    const result = await service.getTeacherProfile('teacher-1', 'teacher-1');
    expect(result.teacherSchedules[0].studentName).toBe('Real Name');
  });

  it('keeps the real data for an admin', async () => {
    const service = makeService();
    const result = await service.getTeacherProfile('teacher-1', 'admin-1');
    expect(result.teacherSchedules[0].studentName).toBe('Real Name');
  });
});
