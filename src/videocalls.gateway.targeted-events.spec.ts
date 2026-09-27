import { VideoCallsGateway } from './videocalls.gateaway';

/**
 * Phase 3 (2026-09-27): several gateway events used to go to every connected
 * socket platform-wide (this.server.emit / socket.broadcast.emit) instead of
 * only the users who actually care. On a platform with many concurrent
 * users this means every login/logout, every schedule change and every
 * support-chat message fanned out to everyone online. These tests pin the
 * new targeted behaviour down.
 */

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const TEACHER = '33333333-3333-3333-3333-333333333333';
const STUDENT = '44444444-4444-4444-4444-444444444444';
const CO_TEACHER = '55555555-5555-5555-5555-555555555555';

const makeSocket = (userId?: string, id = 'socket-1') => ({
  id,
  data: userId ? { userId, authenticated: true } : { authenticated: false },
  emit: jest.fn(),
  broadcast: { emit: jest.fn(), to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
});

const baseRepo = () => ({
  isMember: jest.fn().mockResolvedValue(false),
  canJoinRoom: jest.fn().mockResolvedValue(true),
  getMemberIds: jest.fn().mockResolvedValue([]),
  getContactUserIds: jest.fn().mockResolvedValue([]),
});

const makeGateway = (conversationsRepository: any, userRepo: any) => {
  const gateway = new VideoCallsGateway(
    { saveGlobalChat: jest.fn(), findGlobalChatById: jest.fn() } as any, // chatsRepository
    { bulkIncrementCounter: jest.fn() } as any, // unreadCounterService
    { verify: jest.fn() } as any, // jwtService
    userRepo,
    conversationsRepository,
    { sendCallNotification: jest.fn().mockResolvedValue(undefined) } as any, // pushService
    { attach: jest.fn() } as any, // scheduleBroadcaster
  );
  (gateway as any).server = {
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    emit: jest.fn(),
    sockets: { adapter: { rooms: new Map() } },
  };
  return gateway;
};

describe('VideoCallsGateway — userStatus only reaches contacts', () => {
  it('registerUser broadcasts online status only to the user\'s contacts', async () => {
    const repo = baseRepo();
    repo.getContactUserIds.mockResolvedValue([USER_B]);
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: USER_A, name: 'Ana', lastName: 'Lopez', online: 'offline' }),
      save: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    const gateway = makeGateway(repo, userRepo);
    const emitToUsers = jest.spyOn(gateway as any, 'emitToUsers').mockImplementation(() => undefined);

    await gateway.handleRegisterUser(makeSocket(USER_A) as any, { userId: USER_A });

    expect(repo.getContactUserIds).toHaveBeenCalledWith(USER_A);
    expect(emitToUsers).toHaveBeenCalledWith([USER_B], 'userStatus', expect.objectContaining({ id: USER_A, online: 'online' }));
  });

  it('notifyUserOffline (login/logout path) emits only to contacts, never a full broadcast', async () => {
    const repo = baseRepo();
    repo.getContactUserIds.mockResolvedValue([USER_B]);
    const gateway = makeGateway(repo, { findOne: jest.fn(), find: jest.fn(), save: jest.fn() });
    const emitToUsers = jest.spyOn(gateway as any, 'emitToUsers').mockImplementation(() => undefined);

    await gateway.notifyUserOffline({ id: USER_A, name: 'Ana Lopez' });

    expect(repo.getContactUserIds).toHaveBeenCalledWith(USER_A);
    expect(emitToUsers).toHaveBeenCalledWith([USER_B], 'userStatus', { id: USER_A, online: 'offline', name: 'Ana Lopez' });
  });

  it('swallows a contacts lookup failure instead of throwing (fire-and-forget caller)', async () => {
    const repo = baseRepo();
    repo.getContactUserIds.mockRejectedValue(new Error('db down'));
    const gateway = makeGateway(repo, { findOne: jest.fn(), find: jest.fn(), save: jest.fn() });

    await expect(gateway.notifyUserOnline({ id: USER_A, name: 'Ana' })).resolves.not.toThrow();
  });
});

describe('VideoCallsGateway — scheduleUpdated/studentAssigned/studentRemoved are targeted', () => {
  it('scheduleUpdated reaches the student, the teacher and any co-teachers — nobody else', () => {
    const gateway = makeGateway(baseRepo(), { findOne: jest.fn(), find: jest.fn() });
    const emitToUsers = jest.spyOn(gateway as any, 'emitToUsers').mockImplementation(() => undefined);

    gateway.notifyScheduleUpdated({
      studentId: STUDENT,
      action: 'modify',
      schedule: { teacherId: TEACHER, studentId: STUDENT, coTeacherIds: [CO_TEACHER] },
    });

    const [targets, event] = emitToUsers.mock.calls[0] as [string[], string, any];
    expect(event).toBe('scheduleUpdated');
    expect(new Set(targets)).toEqual(new Set([STUDENT, TEACHER, CO_TEACHER]));
  });

  it('studentAssigned reaches only the teacher and the student', () => {
    const gateway = makeGateway(baseRepo(), { findOne: jest.fn(), find: jest.fn() });
    const emitToUsers = jest.spyOn(gateway as any, 'emitToUsers').mockImplementation(() => undefined);

    gateway.notifyStudentAssigned({
      teacherId: TEACHER, studentId: STUDENT, schedules: [], student: {}, teacher: {},
    });

    expect(emitToUsers).toHaveBeenCalledWith([TEACHER, STUDENT], 'studentAssigned', expect.anything());
  });

  it('studentRemoved reaches only the teacher and the removed students', () => {
    const gateway = makeGateway(baseRepo(), { findOne: jest.fn(), find: jest.fn() });
    const emitToUsers = jest.spyOn(gateway as any, 'emitToUsers').mockImplementation(() => undefined);

    gateway.notifyStudentRemoved({
      teacherId: TEACHER, studentIds: [STUDENT, USER_B], deletedScheduleIds: [],
    });

    expect(emitToUsers).toHaveBeenCalledWith([TEACHER, STUDENT, USER_B], 'studentRemoved', expect.anything());
  });
});

describe('VideoCallsGateway — support-chat unread ping only reaches staff', () => {
  it('newUnreadSupportMessage goes to teachers/admins, not every connected socket, and never back to the sender', async () => {
    const repo = baseRepo();
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: TEACHER, name: 'T', lastName: 'One', email: 't@x.com', role: 'teacher', avatarUrl: null }),
      find: jest.fn().mockResolvedValue([{ id: TEACHER }, { id: 'admin-1' }]),
      save: jest.fn(),
    };
    const gateway = makeGateway(repo, userRepo);
    const emitToUsers = jest.spyOn(gateway as any, 'emitToUsers').mockImplementation(() => undefined);
    const socket = makeSocket(TEACHER);

    await gateway.handleSupportChat(socket as any, { message: 'need help' });

    expect(userRepo.find).toHaveBeenCalledWith({ where: [{ role: 'teacher' }, { role: 'admin' }], select: ['id'] });
    expect(emitToUsers).toHaveBeenCalledWith(['admin-1'], 'newUnreadSupportMessage', { room: 'uuid-support' });
    // Old behaviour used socket.broadcast.emit — must be gone.
    expect(socket.broadcast.emit).not.toHaveBeenCalled();
  });
});
