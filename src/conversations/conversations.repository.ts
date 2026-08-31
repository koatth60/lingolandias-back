import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Conversation, ConversationType } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { ArchivedMessage } from './entities/archived-message.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ConversationsRepository {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly memberRepo: Repository<ConversationMember>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(ArchivedMessage)
    private readonly archivedRepo: Repository<ArchivedMessage>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getMemberIds(conversationId: string): Promise<string[]> {
    const rows = await this.memberRepo.find({ where: { conversationId } });
    return rows.map((r) => r.userId);
  }

  async getMembers(conversationId: string) {
    const rows = await this.memberRepo.find({ where: { conversationId } });
    if (!rows.length) return [];
    const users = await this.userRepo.findBy({ id: In(rows.map((r) => r.userId)) });
    const userById = new Map(users.map((u) => [u.id, u]));
    return rows
      .map((r) => {
        const u = userById.get(r.userId);
        if (!u) return null;
        return {
          id: u.id, name: u.name, lastName: u.lastName, email: u.email,
          avatarUrl: u.avatarUrl, role: u.role, online: u.online,
          memberRole: r.role,
        };
      })
      .filter(Boolean);
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const row = await this.memberRepo.findOne({ where: { conversationId, userId } });
    return !!row;
  }

  async findUserConversations(userId: string) {
    const memberships = (await this.memberRepo.find({ where: { userId } })).filter(
      (m) => m.conversationId !== 'uuid-support',
    );
    if (!memberships.length) return [];

    const conversationIds = memberships.map((m) => m.conversationId);
    const lastReadByConv = new Map(memberships.map((m) => [m.conversationId, m.lastReadAt]));

    const conversations = await this.conversationRepo.findBy({ id: In(conversationIds) });

    // For DMs, resolve the *other* member so the client can show their name/avatar.
    const dmIds = conversations.filter((c) => c.type === 'dm').map((c) => c.id);
    const otherUserIdByConv = new Map<string, string>();
    if (dmIds.length) {
      const otherRows = await this.memberRepo
        .createQueryBuilder('m')
        .where('m.conversationId IN (:...dmIds)', { dmIds })
        .andWhere('m.userId != :userId', { userId })
        .getMany();
      otherRows.forEach((r) => otherUserIdByConv.set(r.conversationId, r.userId));
    }
    const otherUsers = otherUserIdByConv.size
      ? await this.userRepo.findBy({ id: In([...otherUserIdByConv.values()]) })
      : [];
    const otherUserById = new Map(otherUsers.map((u) => [u.id, u]));

    // Latest message per conversation.
    const lastMessages = conversationIds.length
      ? await this.messageRepo
          .createQueryBuilder('m')
          .distinctOn(['m.conversationId'])
          .where('m.conversationId IN (:...conversationIds)', { conversationIds })
          .orderBy('m.conversationId')
          .addOrderBy('m.timestamp', 'DESC')
          .getMany()
      : [];
    const lastMessageByConv = new Map(lastMessages.map((m) => [m.conversationId, m]));

    // Fallback to archived history for conversations whose only activity is
    // older than the archive cutoff — otherwise they'd look empty even though
    // they have real history.
    const missingConvIds = conversationIds.filter((id) => !lastMessageByConv.has(id));
    if (missingConvIds.length) {
      const archivedLast = await this.archivedRepo
        .createQueryBuilder('am')
        .distinctOn(['am.conversationId'])
        .where('am.conversationId IN (:...missingConvIds)', { missingConvIds })
        .orderBy('am.conversationId')
        .addOrderBy('am.timestamp', 'DESC')
        .getMany();
      archivedLast.forEach((am) => lastMessageByConv.set(am.conversationId, am as any));
    }

    // Unread counts: messages after this member's lastReadAt, not sent by them.
    const unreadRows = conversationIds.length
      ? await this.dataSource.query(
          `SELECT m."conversationId" as "conversationId", COUNT(*)::int as count
           FROM messages m
           JOIN conversation_members cm
             ON cm."conversationId" = m."conversationId" AND cm."userId" = $1
           WHERE m."conversationId" = ANY($2)
             AND (m."senderId" IS NULL OR m."senderId" != $1)
             AND (cm."lastReadAt" IS NULL OR m."timestamp" > cm."lastReadAt")
           GROUP BY m."conversationId"`,
          [userId, conversationIds],
        )
      : [];
    const unreadByConv = new Map(unreadRows.map((r: any) => [r.conversationId, r.count]));

    return conversations
      .map((c) => {
        const otherUser = otherUserIdByConv.has(c.id) ? otherUserById.get(otherUserIdByConv.get(c.id)) : null;
        const lastMessage = lastMessageByConv.get(c.id);
        return {
          id: c.id,
          type: c.type,
          name: c.type === 'dm' ? null : c.name,
          avatarUrl: c.type === 'dm' ? otherUser?.avatarUrl : c.avatarUrl,
          language: c.language,
          linkedToSchedule: c.linkedToSchedule,
          otherUser: otherUser
            ? { id: otherUser.id, name: otherUser.name, lastName: otherUser.lastName, avatarUrl: otherUser.avatarUrl, online: otherUser.online, role: otherUser.role }
            : null,
          lastMessage: lastMessage
            ? {
                content: lastMessage.fileUrl ? '📎 File' : lastMessage.message,
                senderId: lastMessage.senderId,
                username: lastMessage.username,
                timestamp: lastMessage.timestamp,
              }
            : null,
          unreadCount: unreadByConv.get(c.id) || 0,
          lastActivityAt: lastMessage?.timestamp || c.createdAt,
        };
      })
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  }

  async findOrCreateDm(userId: string, otherUserId: string): Promise<Conversation> {
    if (userId === otherUserId) {
      throw new NotFoundException('Cannot start a conversation with yourself');
    }
    const existing = await this.dataSource.query(
      `SELECT c.* FROM conversations c
       JOIN conversation_members m1 ON m1."conversationId" = c.id AND m1."userId" = $1
       JOIN conversation_members m2 ON m2."conversationId" = c.id AND m2."userId" = $2
       WHERE c.type = 'dm'
       LIMIT 1`,
      [userId, otherUserId],
    );
    if (existing.length) return existing[0];

    const id = randomUUID();
    return this.dataSource.transaction(async (manager) => {
      const conversation = manager.create(Conversation, { id, type: 'dm' as ConversationType });
      await manager.save(conversation);
      await manager.save(ConversationMember, [
        { conversationId: id, userId, role: 'member' },
        { conversationId: id, userId: otherUserId, role: 'member' },
      ]);
      return conversation;
    });
  }

  async createGroup(params: {
    createdBy: string;
    name: string;
    avatarUrl?: string;
    memberIds: string[];
  }): Promise<Conversation> {
    const { createdBy, name, avatarUrl, memberIds } = params;
    const uniqueMemberIds = [...new Set(memberIds.filter((id) => id !== createdBy))];
    if (!name?.trim()) throw new NotFoundException('Group name is required');
    if (!uniqueMemberIds.length) throw new NotFoundException('A group needs at least one other member');

    const id = randomUUID();
    return this.dataSource.transaction(async (manager) => {
      const conversation = manager.create(Conversation, {
        id,
        type: 'group' as ConversationType,
        name: name.trim(),
        avatarUrl,
        createdBy,
      });
      await manager.save(conversation);
      await manager.save(ConversationMember, [
        { conversationId: id, userId: createdBy, role: 'owner' },
        ...uniqueMemberIds.map((userId) => ({ conversationId: id, userId, role: 'member' as const })),
      ]);
      return conversation;
    });
  }

  async addMember(conversationId: string, userId: string) {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type !== 'group') throw new NotFoundException('Only groups support adding members');
    const already = await this.isMember(conversationId, userId);
    if (already) return;
    await this.memberRepo.save({ conversationId, userId, role: 'member' });
  }

  async removeMember(conversationId: string, userId: string) {
    await this.memberRepo.delete({ conversationId, userId });
  }

  async renameGroup(
    conversationId: string,
    params: { name?: string; avatarUrl?: string; linkedToSchedule?: boolean },
  ) {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type !== 'group') throw new NotFoundException('Only groups can be renamed');
    if (params.name?.trim()) conversation.name = params.name.trim();
    if (params.avatarUrl !== undefined) conversation.avatarUrl = params.avatarUrl;
    if (params.linkedToSchedule !== undefined) conversation.linkedToSchedule = params.linkedToSchedule;
    return this.conversationRepo.save(conversation);
  }

  async getMessages(conversationId: string, opts: { before?: string; limit?: number }) {
    const limit = Math.min(opts.limit || 50, 100);
    const qb = this.messageRepo
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', { conversationId })
      .orderBy('m.timestamp', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit);

    let cursor: { timestamp: Date; id: string } | undefined;
    if (opts.before) {
      const found = await this.messageRepo.findOneBy({ id: opts.before });
      if (found) {
        cursor = found;
        qb.andWhere('(m.timestamp, m.id) < (:ts, :id)', { ts: found.timestamp, id: found.id });
      }
    }
    const messages = await qb.getMany();

    // Active messages alone weren't enough to fill the page (either this
    // conversation's whole history is short, or we've scrolled past the
    // active window) — pull the rest from archived_messages so history
    // doesn't just silently stop once it ages out of the active table.
    const remaining = limit - messages.length;
    if (remaining > 0) {
      const archQb = this.archivedRepo
        .createQueryBuilder('am')
        .where('am.conversationId = :conversationId', { conversationId })
        .orderBy('am.timestamp', 'DESC')
        .addOrderBy('am.id', 'DESC')
        .take(remaining);

      const archCursor = messages.length
        ? { timestamp: messages[messages.length - 1].timestamp, id: messages[messages.length - 1].id }
        : cursor;
      if (archCursor) {
        archQb.andWhere('(am.timestamp, am.id) < (:ts, :id)', { ts: archCursor.timestamp, id: archCursor.id });
      }
      const archived = await archQb.getMany();
      messages.push(...(archived as any));
    }

    return messages.reverse();
  }

  async getArchivedMessages(conversationId: string, page: number) {
    return this.archivedRepo
      .createQueryBuilder('am')
      .where('am.conversationId = :conversationId', { conversationId })
      .orderBy('am.timestamp', 'DESC')
      .take(50)
      .skip((page - 1) * 50)
      .getMany();
  }

  async saveMessage(message: Partial<Message>): Promise<Message> {
    return this.messageRepo.save(message);
  }

  async editMessage(id: string, message: string) {
    await this.messageRepo.update(id, { message, editedAt: new Date() });
  }

  async deleteMessage(id: string) {
    await this.messageRepo.delete(id);
  }

  async markRead(conversationId: string, userId: string) {
    await this.memberRepo.update({ conversationId, userId }, { lastReadAt: new Date() });
  }

  // Every new user must join their language's general room (and teacher/support
  // rooms if applicable) the same way the one-off migration back-filled this for
  // existing users — otherwise anyone signing up after the migration would never
  // see those rooms in their conversation list.
  async autoJoinLegacyRooms(user: { id: string; role: string; language?: string }) {
    const language = user.language?.toLowerCase();
    const conversationIds: string[] = [];

    if (language && ['english', 'spanish', 'polish'].includes(language)) {
      conversationIds.push(`uuid-${language}`);
      if (user.role === 'teacher') conversationIds.push(`uuid-teacher-${language}`);
    }
    if (user.role === 'teacher' || user.role === 'admin') {
      conversationIds.push('uuid-support');
    }
    if (user.role === 'admin') {
      conversationIds.push(
        'uuid-english', 'uuid-spanish', 'uuid-polish',
        'uuid-teacher-english', 'uuid-teacher-spanish', 'uuid-teacher-polish',
      );
    }
    if (!conversationIds.length) return;

    const rows = [...new Set(conversationIds)].map((conversationId) => ({
      conversationId,
      userId: user.id,
      role: 'member' as const,
    }));
    await this.memberRepo
      .createQueryBuilder()
      .insert()
      .values(rows)
      .orIgnore()
      .execute();
  }
}
