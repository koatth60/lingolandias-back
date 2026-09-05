import { NotFoundException } from '@nestjs/common';
import { ConversationsRepository } from './conversations.repository';
import { ConversationMember } from './entities/conversation-member.entity';

describe('ConversationsRepository', () => {
  let repo: ConversationsRepository;
  let conversationRepo: any;
  let memberRepo: any;
  let messageRepo: any;
  let archivedRepo: any;
  let userRepo: any;
  let scheduleRepo: any;
  let dataSource: any;
  let scheduleBroadcaster: any;

  beforeEach(() => {
    conversationRepo = { findOneBy: jest.fn(), create: jest.fn(), save: jest.fn() };
    memberRepo = {
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    messageRepo = { save: jest.fn(), update: jest.fn(), delete: jest.fn(), findOneBy: jest.fn() };
    archivedRepo = {};
    userRepo = {};
    scheduleRepo = {};
    dataSource = { query: jest.fn(), transaction: jest.fn() };
    scheduleBroadcaster = {};

    repo = new ConversationsRepository(
      conversationRepo,
      memberRepo,
      messageRepo,
      archivedRepo,
      userRepo,
      scheduleRepo,
      dataSource,
      scheduleBroadcaster,
    );
  });

  describe('findOrCreateDm', () => {
    it('refuses to open a conversation with yourself', async () => {
      await expect(repo.findOrCreateDm('u1', 'u1')).rejects.toThrow(NotFoundException);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('reuses an existing DM instead of creating a duplicate', async () => {
      const existingRow = { id: 'conv-1', type: 'dm' };
      dataSource.query.mockResolvedValue([existingRow]);

      const result = await repo.findOrCreateDm('u1', 'u2');

      expect(result).toEqual(existingRow);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('creates exactly one new dm conversation with both members when none exists', async () => {
      dataSource.query.mockResolvedValue([]);
      const manager = { create: jest.fn().mockReturnValue({ id: 'new-conv', type: 'dm' }), save: jest.fn() };
      dataSource.transaction.mockImplementation((cb: any) => cb(manager));

      const result = await repo.findOrCreateDm('u1', 'u2');

      expect(manager.save).toHaveBeenCalledWith(
        ConversationMember,
        expect.arrayContaining([
          expect.objectContaining({ userId: 'u1', role: 'member' }),
          expect.objectContaining({ userId: 'u2', role: 'member' }),
        ]),
      );
      expect(result).toEqual({ id: 'new-conv', type: 'dm' });
    });
  });

  describe('toggleReaction', () => {
    it('adds a reaction from a user who has not reacted with that emoji yet', async () => {
      messageRepo.findOneBy.mockResolvedValue({ id: 'm1', reactions: {} });

      const result = await repo.toggleReaction('m1', 'u1', 'Ana', '👍');

      expect(result).toEqual({ '👍': [{ id: 'u1', name: 'Ana' }] });
      expect(messageRepo.update).toHaveBeenCalledWith('m1', { reactions: result });
    });

    it('removes the reaction on a second toggle by the same user (not a duplicate add)', async () => {
      messageRepo.findOneBy.mockResolvedValue({
        id: 'm1',
        reactions: { '👍': [{ id: 'u1', name: 'Ana' }] },
      });

      const result = await repo.toggleReaction('m1', 'u1', 'Ana', '👍');

      expect(result).toEqual({});
    });

    it('drops the emoji key entirely once its last reactor removes it, instead of leaving an empty array', async () => {
      messageRepo.findOneBy.mockResolvedValue({
        id: 'm1',
        reactions: { '👍': [{ id: 'u1', name: 'Ana' }], '🎉': [{ id: 'u2', name: 'Sam' }] },
      });

      const result = await repo.toggleReaction('m1', 'u1', 'Ana', '👍');

      expect(result).toEqual({ '🎉': [{ id: 'u2', name: 'Sam' }] });
    });

    it('returns an empty object without writing when the message no longer exists', async () => {
      messageRepo.findOneBy.mockResolvedValue(null);

      const result = await repo.toggleReaction('deleted-msg', 'u1', 'Ana', '👍');

      expect(result).toEqual({});
      expect(messageRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('autoJoinLegacyRooms', () => {
    const captureInsertedIds = () => {
      const values = jest.fn().mockReturnThis();
      const chain = {
        insert: jest.fn().mockReturnThis(),
        values,
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      };
      memberRepo.createQueryBuilder.mockReturnValue(chain);
      return values;
    };

    it('joins a student to only the general room for their language, never the teacher room', async () => {
      const values = captureInsertedIds();

      await repo.autoJoinLegacyRooms({ id: 'u1', role: 'user', language: 'Spanish' });

      const rows = values.mock.calls[0][0];
      expect(rows.map((r: any) => r.conversationId)).toEqual(['uuid-spanish']);
    });

    it('joins an invitado the same as a student — general room only, no teacher-only room', async () => {
      const values = captureInsertedIds();

      await repo.autoJoinLegacyRooms({ id: 'u1', role: 'invitado', language: 'English' });

      const rows = values.mock.calls[0][0];
      expect(rows.map((r: any) => r.conversationId)).toEqual(['uuid-english']);
    });

    it('joins a teacher to both the general and teacher-only room for their language, plus support', async () => {
      const values = captureInsertedIds();

      await repo.autoJoinLegacyRooms({ id: 't1', role: 'teacher', language: 'Polish' });

      const rows = values.mock.calls[0][0];
      expect(rows.map((r: any) => r.conversationId).sort()).toEqual(
        ['uuid-polish', 'uuid-support', 'uuid-teacher-polish'].sort(),
      );
    });

    it('does nothing for a user with no recognized language and a role that gets no other room', async () => {
      await repo.autoJoinLegacyRooms({ id: 'u1', role: 'user', language: undefined });

      expect(memberRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
