import { ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { RolesGuard } from './auth/guards/roles.guard';
import { AuthGuard } from './auth/guards/auth.guard';
import { UsersService } from './users/users.service';
import { ConversationsRepository } from './conversations/conversations.repository';
import { ConversationsService } from './conversations/conversations.service';
import { ChatService } from './chat/chat.service';
import { ClassSessionsService } from './class-sessions/class-sessions.service';
import { JibriSecretGuard } from './upload-files/jibri-secret.guard';
import { User } from './users/entities/user.entity';

/**
 * Regression tests for the 2026-09-26 authorization fixes ("Fase 0"). Each
 * block pins down one hole that was open in production: a route that
 * checked login but not role or ownership, or trusted an id from the body.
 */

const httpContext = (request: any, roles?: string[]) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
    __roles: roles,
  }) as any;

describe('RolesGuard', () => {
  const makeGuard = (roles: string[] | undefined, dbUser: any) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) };
    const repo = { findOne: jest.fn().mockResolvedValue(dbUser) };
    const dataSource = { getRepository: jest.fn().mockReturnValue(repo) };
    return new RolesGuard(reflector as any, dataSource as any);
  };

  it('lets routes without @Roles through', async () => {
    const guard = makeGuard(undefined, null);
    await expect(guard.canActivate(httpContext({ user: { id: 'u1' } }))).resolves.toBe(true);
  });

  it('reads the role from the database, not the token', async () => {
    const guard = makeGuard(['admin'], { id: 'u1', role: 'user' });
    const request = { user: { id: 'u1', role: 'admin' } };
    await expect(guard.canActivate(httpContext(request))).rejects.toThrow(ForbiddenException);
  });

  it('allows a matching role and exposes it on the request', async () => {
    const guard = makeGuard(['admin'], { id: 'u1', role: 'admin' });
    const request: any = { user: { id: 'u1' } };
    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request.user.role).toBe('admin');
  });

  it('rejects a valid token whose user no longer exists', async () => {
    const guard = makeGuard(['admin'], null);
    await expect(guard.canActivate(httpContext({ user: { id: 'gone' } }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('AuthGuard', () => {
  it('refuses a password-reset token used as a session token', () => {
    const jwt = { verify: jest.fn().mockReturnValue({ id: 'u1', h: 'abcdefghij' }) };
    const guard = new AuthGuard(jwt as any);
    const request = { headers: { authorization: 'Bearer reset-token' } };
    expect(() => guard.canActivate(httpContext(request))).toThrow(UnauthorizedException);
  });

  it('accepts a normal session token', () => {
    const jwt = { verify: jest.fn().mockReturnValue({ id: 'u1', email: 'a@b.c', exp: 1, iat: 1 }) };
    const guard = new AuthGuard(jwt as any);
    const request: any = { headers: { authorization: 'Bearer ok' } };
    expect(guard.canActivate(httpContext(request))).toBe(true);
    expect(request.user.id).toBe('u1');
  });
});

describe('User serialization', () => {
  it('never includes the password hash, also for nested users', () => {
    const student = Object.assign(new User(), { id: 's1', name: 'S', password: 'hash-s' });
    const teacher = Object.assign(new User(), {
      id: 't1',
      name: 'T',
      password: 'hash-t',
      students: [student],
    });
    const json = JSON.stringify({ user: teacher });
    expect(json).not.toContain('hash-');
    expect(JSON.parse(json).user.students[0].name).toBe('S');
  });
});

describe('UsersService.update (POST /users/updateuser)', () => {
  const makeService = () => {
    const usersRepository = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const service = Object.create(UsersService.prototype);
    service.usersRepository = usersRepository;
    return { service: service as UsersService, usersRepository };
  };

  it('updates the caller by id and drops role, password, email and id', async () => {
    const { service, usersRepository } = makeService();
    await service.update('me', {
      name: 'New',
      role: 'admin',
      password: '$2b$fake',
      email: 'victim@x.com',
      id: 'victim',
    });
    expect(usersRepository.update).toHaveBeenCalledWith('me', { name: 'New' });
  });

  it('rejects a body with nothing editable', async () => {
    const { service } = makeService();
    await expect(service.update('me', { role: 'admin' })).rejects.toThrow(BadRequestException);
  });
});

describe('ConversationsRepository.ensureDm', () => {
  let repo: ConversationsRepository;
  let conversationRepo: any;
  let memberRepo: any;
  let userRepo: any;
  let scheduleRepo: any;

  beforeEach(() => {
    conversationRepo = { findOneBy: jest.fn(), create: jest.fn((x) => x), save: jest.fn() };
    memberRepo = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() };
    userRepo = { findOne: jest.fn() };
    scheduleRepo = { count: jest.fn().mockResolvedValue(0) };
    repo = new ConversationsRepository(
      conversationRepo,
      memberRepo,
      {} as any,
      {} as any,
      userRepo,
      scheduleRepo,
      {} as any,
      {} as any,
    );
  });

  it('refuses an outsider joining another student\'s DM', async () => {
    conversationRepo.findOneBy.mockResolvedValue({ id: 'student-1', type: 'dm' });
    userRepo.findOne.mockResolvedValue({ id: 'student-1', teacher: { id: 'teacher-1' } });

    await expect(repo.ensureDm('student-1', 'attacker', 'student-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(memberRepo.save).not.toHaveBeenCalled();
  });

  it('lets the assigned teacher repair the legacy DM', async () => {
    conversationRepo.findOneBy.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({ id: 'student-1', teacher: { id: 'teacher-1' } });

    await repo.ensureDm('student-1', 'teacher-1', 'student-1');
    expect(memberRepo.save).toHaveBeenCalledTimes(2);
  });

  it('accepts a teacher who only has a scheduled class with the student', async () => {
    conversationRepo.findOneBy.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({ id: 'student-1', teacher: null });
    scheduleRepo.count.mockResolvedValue(1);

    await repo.ensureDm('student-1', 'student-1', 'teacher-2');
    expect(memberRepo.save).toHaveBeenCalled();
  });
});

describe('ConversationsService.addMemberAsMember (POST /conversations/:id/members)', () => {
  it('refuses a caller who is not in the conversation', async () => {
    const conversationsRepository = {
      isMemberOrAdmin: jest.fn().mockResolvedValue(false),
      addMember: jest.fn(),
    };
    const service = new ConversationsService(conversationsRepository as any);
    await expect(
      service.addMemberAsMember('conv', 'attacker', { addedBy: 'attacker', shareHistory: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(conversationsRepository.addMember).not.toHaveBeenCalled();
  });
});

describe('ChatService.deleteGlobalChatAs (support messages)', () => {
  const makeService = (message: any) => {
    const repo = {
      findGlobalChatById: jest.fn().mockResolvedValue(message),
      deleteGlobalChat: jest.fn(),
    };
    return { service: new ChatService(repo as any), repo };
  };

  it('refuses a teacher deleting someone else\'s message', async () => {
    const { service, repo } = makeService({ id: 'm1', senderId: 'other', email: 'o@x.com' });
    await expect(
      service.deleteGlobalChatAs('m1', { id: 'me', email: 'me@x.com', role: 'teacher' }),
    ).rejects.toThrow(ForbiddenException);
    expect(repo.deleteGlobalChat).not.toHaveBeenCalled();
  });

  it('lets the author delete, falling back to email for old rows', async () => {
    const { service, repo } = makeService({ id: 'm1', senderId: null, email: 'me@x.com' });
    await service.deleteGlobalChatAs('m1', { id: 'me', email: 'me@x.com', role: 'teacher' });
    expect(repo.deleteGlobalChat).toHaveBeenCalledWith('m1');
  });

  it('lets an admin delete any message', async () => {
    const { service, repo } = makeService({ id: 'm1', senderId: 'other', email: 'o@x.com' });
    await service.deleteGlobalChatAs('m1', { id: 'admin', email: 'a@x.com', role: 'admin' });
    expect(repo.deleteGlobalChat).toHaveBeenCalledWith('m1');
  });
});

describe('ClassSessionsService.endSession', () => {
  it('clamps claimed minutes to the real elapsed time', async () => {
    const startTime = new Date(Date.now() - 10 * 60000);
    const repo = {
      findOne: jest.fn().mockResolvedValue({ id: 's1', teacherId: 't1', startTime }),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const service = new ClassSessionsService(repo as any);
    await service.endSession('s1', 't1', 600);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1', teacherId: 't1' },
      expect.objectContaining({ durationMinutes: 10 }),
    );
  });

  it('ignores a session that belongs to another teacher', async () => {
    const repo = { findOne: jest.fn().mockResolvedValue(null), update: jest.fn(), delete: jest.fn() };
    const service = new ClassSessionsService(repo as any);
    await service.endSession('s1', 'intruder', 60);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe('JibriSecretGuard', () => {
  const original = process.env.JIBRI_UPLOAD_SECRET;
  afterEach(() => {
    process.env.JIBRI_UPLOAD_SECRET = original;
  });
  const ctx = (secret?: string) =>
    httpContext({ headers: secret === undefined ? {} : { 'x-jibri-secret': secret } });

  it('fails closed when no secret is configured', () => {
    delete process.env.JIBRI_UPLOAD_SECRET;
    expect(() => new JibriSecretGuard().canActivate(ctx('anything'))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong or missing header', () => {
    process.env.JIBRI_UPLOAD_SECRET = 'correct-secret';
    expect(() => new JibriSecretGuard().canActivate(ctx('wrong-secret!'))).toThrow(UnauthorizedException);
    expect(() => new JibriSecretGuard().canActivate(ctx())).toThrow(UnauthorizedException);
  });

  it('accepts the configured secret', () => {
    process.env.JIBRI_UPLOAD_SECRET = 'correct-secret';
    expect(new JibriSecretGuard().canActivate(ctx('correct-secret'))).toBe(true);
  });
});
