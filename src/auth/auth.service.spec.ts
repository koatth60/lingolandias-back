import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let usersRepository: any;
  let jwtService: any;
  let videoCallsGateway: any;
  let mailService: any;
  let unReadGlobalMessageRepo: any;
  let conversationsRepository: any;

  beforeEach(() => {
    usersRepository = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      register: jest.fn(),
      save: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
    };
    videoCallsGateway = { notifyUserOffline: jest.fn() };
    mailService = {
      sendUserWelcomeEmail: jest.fn(),
      sendUserResetPasswordEmail: jest.fn(),
      sendPasswordChangedEmail: jest.fn(),
    };
    unReadGlobalMessageRepo = { save: jest.fn() };
    conversationsRepository = { autoJoinLegacyRooms: jest.fn() };

    service = new AuthService(
      usersRepository,
      jwtService,
      videoCallsGateway,
      mailService,
      unReadGlobalMessageRepo,
      conversationsRepository,
    );

    jest.clearAllMocks();
  });

  describe('register', () => {
    it('rejects a duplicate email instead of overwriting the existing account', async () => {
      usersRepository.findByEmail.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.register({ email: 'taken@x.com', password: 'pw', name: 'A' }),
      ).rejects.toThrow(BadRequestException);
      expect(usersRepository.register).not.toHaveBeenCalled();
    });

    it('never stores the plaintext password', async () => {
      usersRepository.findByEmail.mockResolvedValue(undefined);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      usersRepository.register.mockResolvedValue({ id: 'new-user', role: 'user' });

      await service.register({ email: 'new@x.com', password: 'plain-pw', name: 'A' });

      expect(usersRepository.register).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'hashed-pw' }),
      );
      expect(mailService.sendUserWelcomeEmail).toHaveBeenCalledWith('A', 'new@x.com', 'plain-pw');
    });
  });

  describe('login', () => {
    it('rejects when email or password is missing', async () => {
      await expect(service.login('', 'pw')).rejects.toThrow(BadRequestException);
      await expect(service.login('a@x.com', '')).rejects.toThrow(BadRequestException);
      expect(usersRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('rejects an unknown email without confirming whether the account exists', async () => {
      usersRepository.findByEmail.mockResolvedValue(undefined);

      await expect(service.login('ghost@x.com', 'pw')).rejects.toThrow(BadRequestException);
    });

    it('rejects a wrong password for a real account', async () => {
      usersRepository.findByEmail.mockResolvedValue({ id: '1', password: 'hashed' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login('real@x.com', 'wrong-pw')).rejects.toThrow(BadRequestException);
    });

    it('returns a signed token and marks the user online on success', async () => {
      const user = { id: '1', email: 'real@x.com', password: 'hashed', online: 'offline' };
      usersRepository.findByEmail
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ ...user, online: 'online', settings: {} });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login('real@x.com', 'correct-pw');

      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ online: 'online' }),
      );
      expect(result.token).toBe('signed-token');
      expect(result.user.online).toBe('online');
    });
  });

  describe('refresh', () => {
    it('rejects if the user behind the token no longer exists', async () => {
      usersRepository.findById.mockResolvedValue(undefined);

      await expect(service.refresh('deleted-user-id')).rejects.toThrow(BadRequestException);
    });

    it('mints a fresh token for the same identity', async () => {
      usersRepository.findById.mockResolvedValue({ id: '1', email: 'a@x.com' });

      const result = await service.refresh('1');

      expect(jwtService.sign).toHaveBeenCalledWith({ email: 'a@x.com', id: '1' });
      expect(result).toEqual({ token: 'signed-token' });
    });
  });

  describe('setNewPassword', () => {
    it('rejects when the confirmation does not match', async () => {
      await expect(
        service.setNewPassword('token', 'newpw', 'different'),
      ).rejects.toThrow(BadRequestException);
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('rejects an invalid or expired token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.setNewPassword('bad-token', 'newpw', 'newpw'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a token whose password hash snippet no longer matches (already used / stale)', async () => {
      jwtService.verify.mockReturnValue({ id: '1', h: 'old-snippet-' });
      usersRepository.findById.mockResolvedValue({ id: '1', password: 'a-different-hash-xyz' });

      await expect(
        service.setNewPassword('token', 'newpw', 'newpw'),
      ).rejects.toThrow(BadRequestException);
      expect(usersRepository.save).not.toHaveBeenCalled();
    });

    it('updates the password when the token is fresh and matches', async () => {
      const currentHash = 'current-hash-1234567890';
      jwtService.verify.mockReturnValue({ id: '1', h: currentHash.slice(-10) });
      usersRepository.findById.mockResolvedValue({ id: '1', password: currentHash });
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-pw');

      const result = await service.setNewPassword('token', 'newpw', 'newpw');

      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'new-hashed-pw' }),
      );
      expect(result.message).toMatch(/updated/i);
    });
  });

  describe('changePassword', () => {
    it('rejects when the current password is wrong', async () => {
      usersRepository.findById.mockResolvedValue({ id: '1', password: 'hashed' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('1', 'wrong-current', 'newpw', 'newpw'),
      ).rejects.toThrow(BadRequestException);
      expect(usersRepository.save).not.toHaveBeenCalled();
    });

    it('updates the password and notifies the user when everything matches', async () => {
      usersRepository.findById.mockResolvedValue({ id: '1', password: 'hashed', name: 'A', email: 'a@x.com' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-pw');

      await service.changePassword('1', 'correct-current', 'newpw', 'newpw');

      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'new-hashed-pw' }),
      );
      expect(mailService.sendPasswordChangedEmail).toHaveBeenCalledWith('A', 'a@x.com');
    });
  });
});
