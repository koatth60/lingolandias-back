import { UsersRepository } from './users.repository';

describe('UsersRepository.assignStudent', () => {
  let repo: UsersRepository;
  let usersOrm: any;
  let scheduleOrm: any;

  const events = [{ start: '2026-09-10T10:00:00.000Z', end: '2026-09-10T11:00:00.000Z' }];

  beforeEach(() => {
    usersOrm = { findOne: jest.fn(), save: jest.fn() };
    scheduleOrm = { save: jest.fn().mockImplementation((rows) => Promise.resolve(rows)) };
    repo = new UsersRepository(usersOrm, scheduleOrm, {} as any, {} as any);
  });

  it('rejects when the teacher id does not belong to an actual teacher', async () => {
    usersOrm.findOne
      .mockResolvedValueOnce({ id: 't1', role: 'user', students: [] }) // wrong role
      .mockResolvedValueOnce({ id: 's1', role: 'user', studentSchedules: [] });

    await expect(
      repo.assignStudent({ teacherId: 't1', studentId: 's1', events }),
    ).rejects.toThrow('Teacher not found.');
    expect(scheduleOrm.save).not.toHaveBeenCalled();
  });

  it('rejects when the student id does not belong to an actual student', async () => {
    usersOrm.findOne
      .mockResolvedValueOnce({ id: 't1', role: 'teacher', students: [], teacherSchedules: [] })
      .mockResolvedValueOnce({ id: 's1', role: 'teacher', studentSchedules: [] }); // wrong role

    await expect(
      repo.assignStudent({ teacherId: 't1', studentId: 's1', events }),
    ).rejects.toThrow('Student not found.');
    expect(scheduleOrm.save).not.toHaveBeenCalled();
  });

  it('links teacher and student and saves schedules with UTC start/end times on success', async () => {
    const teacher = { id: 't1', role: 'teacher', students: [], teacherSchedules: [], name: 'Ana', lastName: 'B', email: 'ana@x.com' };
    const student = { id: 's1', role: 'user', teacher: null, studentSchedules: [], name: 'Sam', lastName: 'C', email: 'sam@x.com' };
    usersOrm.findOne.mockResolvedValueOnce(teacher).mockResolvedValueOnce(student);

    const result = await repo.assignStudent({ teacherId: 't1', studentId: 's1', events });

    expect(teacher.students).toContain(student);
    expect(student.teacher).toBe(teacher);
    expect(scheduleOrm.save).toHaveBeenCalledWith([
      expect.objectContaining({
        studentId: 's1',
        teacherId: 't1',
        startTime: new Date(events[0].start),
        endTime: new Date(events[0].end),
      }),
    ]);
    expect(usersOrm.save).toHaveBeenCalledWith(teacher);
    expect(usersOrm.save).toHaveBeenCalledWith(student);
    expect(result.studentId).toBe('s1');
    expect(result.teacherId).toBe('t1');
    // the response must be plain data (no circular teacher/student refs) —
    // socket.io throws serializing those, which is exactly why this shape exists.
    expect(result.savedSchedules[0]).not.toHaveProperty('student');
    expect(result.savedSchedules[0]).not.toHaveProperty('teacher');
  });
});
