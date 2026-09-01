import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Conversation, ConversationType } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { ArchivedMessage } from './entities/archived-message.entity';
import { Schedule, User } from '../users/entities/user.entity';
import { ScheduleBroadcaster } from '../gateway/schedule-broadcaster.service';

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
    @InjectRepository(Schedule)
    private readonly scheduleRepo: Repository<Schedule>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly scheduleBroadcaster: ScheduleBroadcaster,
  ) {}

  // Every place below that touches Schedule.groupName or a Schedule row for a
  // linkedToSchedule conversation also pushes it live — otherwise a class's
  // calendar entry only updates for whoever triggered the change, and every
  // other participant (including the teacher's own other sessions) would
  // need a manual refresh to see it.
  private async broadcastRoomRename(roomId: string) {
    const rows = await this.scheduleRepo.find({ where: { roomId } });
    rows.forEach((row) =>
      this.scheduleBroadcaster.notifyScheduleUpdated({
        studentId: row.studentId,
        teacherId: row.teacherId,
        action: 'modify',
        schedule: row,
      }),
    );
  }

  // Recomputes coTeacherIds for a linked room's Schedule rows to exactly
  // "current teacher members minus whoever owns the class" — called
  // whenever group membership changes (add/remove) so a teacher added
  // alongside the real students automatically sees the class on their own
  // calendar too, without needing a Schedule row of their own (which would
  // require a fake studentId). No-op if the room has no Schedule rows yet
  // (not linked to a class).
  async syncCoTeachers(conversationId: string) {
    const existing = await this.scheduleRepo.find({ where: { roomId: conversationId } });
    if (!existing.length) return;
    const primaryTeacherId = existing[0].teacherId;
    const members = await this.getMembersUnchecked(conversationId);
    const coTeacherIds = members
      .filter((m) => m.role === 'teacher' && m.id !== primaryTeacherId)
      .map((m) => m.id);
    await this.scheduleRepo.update(
      { roomId: conversationId },
      { coTeacherIds: coTeacherIds.length ? coTeacherIds : null },
    );
    const updated = await this.scheduleRepo.find({ where: { roomId: conversationId } });
    updated.forEach((row) =>
      this.scheduleBroadcaster.notifyScheduleUpdated({
        studentId: row.studentId,
        teacherId: row.teacherId,
        action: 'modify',
        schedule: row,
      }),
    );
  }

  async getMemberIds(conversationId: string): Promise<string[]> {
    const rows = await this.memberRepo.find({ where: { conversationId } });
    return rows.map((r) => r.userId);
  }

  async getMembers(conversationId: string, requestingUserId?: string) {
    if (!requestingUserId || !(await this.isMember(conversationId, requestingUserId))) {
      throw new ForbiddenException('Not a member of this conversation');
    }
    return this.getMembersUnchecked(conversationId);
  }

  // The membership check above is for the public "who's in this chat"
  // endpoint. Internal callers (computeGroupName, run on every add/remove so
  // the auto-generated name stays current) aren't a member lookup on behalf
  // of a specific user — they need the roster regardless, so they use this
  // directly instead of getMembers, which would otherwise 403 with no
  // requestingUserId to check against.
  private async getMembersUnchecked(conversationId: string) {
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
          memberRole: r.role, lastReadAt: r.lastReadAt,
        };
      })
      .filter(Boolean);
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const row = await this.memberRepo.findOne({ where: { conversationId, userId } });
    return !!row;
  }

  // Socket room ids are shared between real conversations and ad-hoc video
  // call rooms that never became a Conversation row. Only enforce membership
  // when the id actually is a tracked conversation — otherwise every video
  // call join would incorrectly get rejected.
  async canJoinRoom(conversationId: string, userId: string): Promise<boolean> {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation) return true;
    return this.isMember(conversationId, userId);
  }

  async findUserConversations(userId: string, opts: { limit?: number; offset?: number } = {}) {
    const memberships = (await this.memberRepo.find({ where: { userId } })).filter(
      (m) => m.conversationId !== 'uuid-support',
    );
    if (!memberships.length) return { conversations: [], total: 0, hasMore: false };

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

    // Some DMs have no resolvable "other" member (their account was deleted
    // since, or the room predates account creation) — fall back to the
    // display name captured on their own messages so the conversation still
    // shows a real name instead of a blank "?" row.
    const unresolvedDmIds = dmIds.filter(
      (id) => !otherUserById.has(otherUserIdByConv.get(id)),
    );
    const fallbackNameByConv = new Map<string, string>();
    if (unresolvedDmIds.length) {
      const rows = await this.dataSource.query(
        `SELECT DISTINCT ON ("conversationId") "conversationId", username FROM (
           SELECT "conversationId", username, timestamp, "senderId" FROM messages
           UNION ALL
           SELECT "conversationId", username, timestamp, "senderId" FROM archived_messages
         ) all_msgs
         WHERE "conversationId" = ANY($1) AND ("senderId" IS NULL OR "senderId" != $2)
         ORDER BY "conversationId", timestamp DESC`,
        [unresolvedDmIds, userId],
      );
      rows.forEach((r: any) => fallbackNameByConv.set(r.conversationId, r.username));
    }

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

    const membershipByConv = new Map(memberships.map((m) => [m.conversationId, m]));

    const sorted = conversations
      .map((c) => {
        const otherUser = otherUserIdByConv.has(c.id) ? otherUserById.get(otherUserIdByConv.get(c.id)) : null;
        const lastMessage = lastMessageByConv.get(c.id);
        const fallbackName =
          c.type === 'dm' && !otherUser ? fallbackNameByConv.get(c.id) || 'Deleted user' : null;
        const membership = membershipByConv.get(c.id);
        const lastActivityAt = lastMessage?.timestamp || c.createdAt;
        return {
          id: c.id,
          type: c.type,
          name: c.type === 'dm' ? (fallbackName || null) : c.name,
          avatarUrl: c.type === 'dm' ? otherUser?.avatarUrl : c.avatarUrl,
          language: c.language,
          linkedToSchedule: c.linkedToSchedule,
          pinned: membership?.pinned || false,
          muted: membership?.muted || false,
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
          unreadCount: membership?.muted ? 0 : unreadByConv.get(c.id) || 0,
          lastActivityAt,
          // "Deleted for me" stays hidden only until new activity arrives —
          // otherwise clearing a chat would silently swallow future messages.
          // DMs with zero messages ever sent are drafts that never got used —
          // don't clutter the list with them (mirrors the client's draft-chat behavior).
          _hidden:
            (!!membership?.deletedAt && new Date(membership.deletedAt) >= new Date(lastActivityAt)) ||
            (c.type === 'dm' && !lastMessage),
        };
      })
      .filter((c) => !c._hidden)
      .map(({ _hidden, ...c }) => c)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
      });

    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    return {
      conversations: sorted.slice(offset, offset + limit),
      total: sorted.length,
      hasMore: offset + limit < sorted.length,
    };
  }

  // Read-only half of findOrCreateDm below — used so the client can check
  // "do I already have a conversation with this person" (e.g. clicking their
  // name from a group's member list) without side effects. Creating one
  // eagerly on every click, even from findOrCreateDm, would resurrect the
  // exact "phantom empty chat" bug the draft-DM flow was built to avoid.
  async findExistingDm(userId: string, otherUserId: string): Promise<Conversation | null> {
    const existing = await this.dataSource.query(
      `SELECT c.* FROM conversations c
       JOIN conversation_members m1 ON m1."conversationId" = c.id AND m1."userId" = $1
       JOIN conversation_members m2 ON m2."conversationId" = c.id AND m2."userId" = $2
       WHERE c.type = 'dm'
       LIMIT 1`,
      [userId, otherUserId],
    );
    return existing.length ? existing[0] : null;
  }

  async findOrCreateDm(userId: string, otherUserId: string): Promise<Conversation> {
    if (userId === otherUserId) {
      throw new NotFoundException('Cannot start a conversation with yourself');
    }
    const existing = await this.findExistingDm(userId, otherUserId);
    if (existing) return existing;

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

  // Builds "Ana, Carlos, Dana" style names for groups that haven't been
  // manually renamed — recomputed whenever membership changes.
  private async computeGroupName(conversationId: string): Promise<string> {
    const members = await this.getMembersUnchecked(conversationId);
    const firstNames = members.map((m) => m.name).filter(Boolean);
    if (firstNames.length <= 4) return firstNames.join(', ') || 'Group Chat';
    return `${firstNames.slice(0, 3).join(', ')} +${firstNames.length - 3} more`;
  }

  // Adding a member is allowed on any dm/group conversation. Adding to a DM
  // promotes it to a group (a DM structurally only ever has 2 members), since
  // every chat should be able to grow the same way Teams lets you do it.
  async addMember(
    conversationId: string,
    newUserId: string,
    opts: { addedBy: string; shareHistory: boolean },
  ) {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!['dm', 'group'].includes(conversation.type)) {
      throw new NotFoundException('Members can only be added to direct messages or groups');
    }
    const already = await this.isMember(conversationId, newUserId);
    if (already) return conversation;

    if (conversation.type === 'dm') {
      conversation.type = 'group' as ConversationType;
      conversation.createdBy = opts.addedBy;
      await this.conversationRepo.save(conversation);
      // The person who grew the DM into a group becomes its owner.
      await this.memberRepo.update({ conversationId, userId: opts.addedBy }, { role: 'owner' });
    }

    await this.memberRepo.save({
      conversationId,
      userId: newUserId,
      role: 'member',
      historyVisibleFrom: opts.shareHistory ? null : new Date(),
    });

    const refreshed = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!refreshed.nameIsCustom) {
      refreshed.name = await this.computeGroupName(conversationId);
      await this.conversationRepo.save(refreshed);
    }
    if (refreshed.linkedToSchedule) {
      await this.scheduleRepo.update({ roomId: conversationId }, { groupName: refreshed.name });
      await this.broadcastRoomRename(conversationId);
      // Covers a teacher being added alongside real students — they get no
      // Schedule row of their own (studentId must be an actual student) but
      // should still see the class on their own calendar as a co-teacher.
      await this.syncCoTeachers(conversationId);
    }
    return refreshed;
  }

  // Only the conversation owner (the teacher, for a schedule-linked class) or
  // the member themself (leaving) may remove someone — previously anyone
  // could remove anyone. If the group is tied to a scheduled class, the
  // removed student's calendar rows for it are cleaned up too, otherwise
  // they'd keep seeing a class they were just kicked out of.
  async removeMember(conversationId: string, userId: string, requesterId: string) {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (requesterId !== userId) {
      const requesterMembership = await this.memberRepo.findOneBy({ conversationId, userId: requesterId });
      if (!requesterMembership || requesterMembership.role !== 'owner') {
        throw new ForbiddenException('Only the group owner can remove another member');
      }
    }
    await this.memberRepo.delete({ conversationId, userId });
    if (conversation.linkedToSchedule) {
      const removedRows = await this.scheduleRepo.find({ where: { roomId: conversationId, studentId: userId } });
      if (removedRows.length) {
        await this.scheduleRepo.delete({ roomId: conversationId, studentId: userId });
        this.scheduleBroadcaster.notifyScheduleUpdated({
          studentId: userId,
          teacherId: removedRows[0].teacherId,
          action: 'remove',
          eventIds: removedRows.map((r) => r.id),
        });
      }
      // Also drops the departed member from coTeacherIds if they were a
      // co-teacher rather than a student — harmless no-op otherwise.
      await this.syncCoTeachers(conversationId);
    }
    if (conversation.type === 'group' && !conversation.nameIsCustom) {
      conversation.name = await this.computeGroupName(conversationId);
      await this.conversationRepo.save(conversation);
      if (conversation.linkedToSchedule) {
        await this.scheduleRepo.update({ roomId: conversationId }, { groupName: conversation.name });
        await this.broadcastRoomRename(conversationId);
      }
    }
  }

  // requesterId is only supplied by the public rename endpoint (a human
  // renaming from the chat UI) — UsersService's own scheduling orchestration
  // (creating/extending a class) calls this internally to sync
  // linkedToSchedule/name after already verifying the caller is a teacher,
  // so it's exempt from the check below rather than needing to re-prove it.
  async renameGroup(
    conversationId: string,
    params: { name?: string; avatarUrl?: string; linkedToSchedule?: boolean },
    requesterId?: string,
  ) {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type !== 'group') throw new NotFoundException('Only groups can be renamed');

    // A class a teacher scheduled is theirs to name — a member renaming the
    // chat would otherwise silently retitle everyone's calendar event too.
    // An ordinary (never-scheduled) group keeps the original Teams-style
    // "any member can rename" behavior.
    if (params.name?.trim() && conversation.linkedToSchedule && requesterId) {
      const requester = await this.userRepo.findOneBy({ id: requesterId });
      if (!requester || requester.role !== 'teacher' || conversation.createdBy !== requesterId) {
        throw new ForbiddenException('Only the teacher who scheduled this class can rename it');
      }
    }

    if (params.name?.trim()) {
      conversation.name = params.name.trim();
      conversation.nameIsCustom = true;
    }
    if (params.avatarUrl !== undefined) conversation.avatarUrl = params.avatarUrl;
    if (params.linkedToSchedule !== undefined) conversation.linkedToSchedule = params.linkedToSchedule;
    const saved = await this.conversationRepo.save(conversation);
    if (params.name?.trim() && saved.linkedToSchedule) {
      await this.scheduleRepo.update({ roomId: conversationId }, { groupName: saved.name });
      await this.broadcastRoomRename(conversationId);
    }
    return saved;
  }

  async setPinned(conversationId: string, userId: string, pinned: boolean) {
    await this.memberRepo.update({ conversationId, userId }, { pinned });
  }

  async setMuted(conversationId: string, userId: string, muted: boolean) {
    await this.memberRepo.update({ conversationId, userId }, { muted });
  }

  // "Delete for me" — Teams-style: only clears it from this person's own
  // list. Reappears automatically once new activity arrives (see the
  // deletedAt filter in findUserConversations).
  async deleteForMe(conversationId: string, userId: string) {
    await this.memberRepo.update({ conversationId, userId }, { deletedAt: new Date() });
  }

  // Hard-deletes a group for every member. Any member can do this for an
  // ordinary group; a `linkedToSchedule` group is managed by its scheduled
  // class, so only the teacher who owns it can delete it, and doing so also
  // cancels the class for everyone (deletes its Schedule rows) instead of
  // leaving orphaned calendar entries behind.
  async deleteGroup(conversationId: string, requesterId: string): Promise<string[]> {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type !== 'group') {
      throw new ForbiddenException('Only groups can be deleted this way');
    }
    if (conversation.linkedToSchedule) {
      const requester = await this.userRepo.findOneBy({ id: requesterId });
      if (!requester || requester.role !== 'teacher' || conversation.createdBy !== requesterId) {
        throw new ForbiddenException('Only the teacher who scheduled this class can cancel and delete it');
      }
    } else {
      const isRequesterMember = await this.isMember(conversationId, requesterId);
      if (!isRequesterMember) {
        throw new ForbiddenException('Only a member of this group can delete it');
      }
    }

    const memberIds = await this.getMemberIds(conversationId);
    const removedSchedules = conversation.linkedToSchedule
      ? await this.scheduleRepo.find({ where: { roomId: conversationId } })
      : [];
    await this.dataSource.transaction(async (manager) => {
      if (conversation.linkedToSchedule) {
        await manager.delete(Schedule, { roomId: conversationId });
      }
      await manager.delete(ArchivedMessage, { conversationId });
      await manager.delete(Message, { conversationId });
      await manager.delete(ConversationMember, { conversationId });
      await manager.delete(Conversation, { id: conversationId });
    });
    if (removedSchedules.length) {
      const byStudent = new Map<string, string[]>();
      removedSchedules.forEach((row) => {
        byStudent.set(row.studentId, [...(byStudent.get(row.studentId) || []), row.id]);
      });
      byStudent.forEach((eventIds, studentId) => {
        this.scheduleBroadcaster.notifyScheduleUpdated({
          studentId,
          teacherId: removedSchedules[0].teacherId,
          action: 'remove',
          eventIds,
        });
      });
    }
    return memberIds;
  }

  // Admin "observe a class" chat viewer — deliberately bypasses the
  // membership check getMessages enforces below, since an admin isn't a
  // participant in every private class conversation they need to be able
  // to review. Trust boundary is the requester's own role (looked up
  // server-side, not just claimed by the client) rather than membership.
  async getMessagesAsAdmin(conversationId: string, requesterId: string) {
    const requester = await this.userRepo.findOneBy({ id: requesterId });
    if (!requester || requester.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    return this.messageRepo.find({
      where: { conversationId },
      order: { timestamp: 'DESC' },
      take: 100,
    });
  }

  async getMessages(conversationId: string, opts: { before?: string; limit?: number; userId?: string }) {
    const limit = Math.min(opts.limit || 50, 100);

    // Some legacy DM conversations were migrated with their id set to one of
    // the two participants' own userId (see migration 001), so a raw
    // conversationId can collide with a real user's id. Without this check,
    // anyone who learns another user's id (trivial — it's shown all over the
    // UI) could read a conversation they were never added to just by
    // requesting it by that id. Membership is mandatory, not just used to
    // compute a history floor.
    if (!opts.userId) {
      throw new ForbiddenException('userId is required to read conversation messages');
    }
    const membership = await this.memberRepo.findOneBy({ conversationId, userId: opts.userId });
    if (!membership) {
      throw new ForbiddenException('Not a member of this conversation');
    }
    const historyFloor: Date | undefined = membership.historyVisibleFrom || undefined;

    const qb = this.messageRepo
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', { conversationId })
      .orderBy('m.timestamp', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit);
    if (historyFloor) qb.andWhere('m.timestamp >= :historyFloor', { historyFloor });

    let cursor: { timestamp: Date; id: string } | undefined;
    let cursorIsArchived = false;
    if (opts.before) {
      const found = await this.messageRepo.findOneBy({ id: opts.before });
      if (found) {
        cursor = found;
        qb.andWhere('(m.timestamp, m.id) < (:ts, :id)', { ts: found.timestamp, id: found.id });
      } else {
        // The cursor wasn't in the active table — it must be an archived
        // message, meaning we've already paged past everything active.
        // Without this fallback the lookup above silently fails and the
        // query below re-fetches the most recent active messages on every
        // "load more" call, making history look stuck.
        const archFound = await this.archivedRepo.findOneBy({ id: opts.before });
        if (archFound) {
          cursor = archFound;
          cursorIsArchived = true;
        }
      }
    }
    const messages = cursorIsArchived ? [] : await qb.getMany();

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
      if (historyFloor) archQb.andWhere('am.timestamp >= :historyFloor', { historyFloor });

      const archCursor = messages.length
        ? { timestamp: messages[messages.length - 1].timestamp, id: messages[messages.length - 1].id }
        : cursor;
      if (archCursor) {
        archQb.andWhere('(am.timestamp, am.id) < (:ts, :id)', { ts: archCursor.timestamp, id: archCursor.id });
      }
      const archived = await archQb.getMany();
      messages.push(...(archived as any));
    }

    // A message can briefly exist in both tables if the archive job's
    // insert-then-delete isn't atomic — de-dupe by id so a client never
    // renders the same message twice.
    const seen = new Set<string>();
    const deduped = messages.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    return deduped.reverse();
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

  async editMessage(id: string, message: string, editedAt: Date = new Date()) {
    await this.messageRepo.update(id, { message, editedAt });
  }

  async deleteMessage(id: string) {
    await this.messageRepo.delete(id);
  }

  async toggleReaction(
    messageId: string,
    userId: string,
    userName: string,
    emoji: string,
  ): Promise<Record<string, { id: string; name: string }[]>> {
    const msg = await this.messageRepo.findOneBy({ id: messageId });
    if (!msg) return {};
    const reactions: Record<string, { id: string; name: string }[]> = { ...(msg.reactions || {}) };
    const current = reactions[emoji] || [];
    const already = current.some((r) => r.id === userId);
    const next = already ? current.filter((r) => r.id !== userId) : [...current, { id: userId, name: userName }];
    if (next.length) reactions[emoji] = next;
    else delete reactions[emoji];
    await this.messageRepo.update(messageId, { reactions });
    return reactions;
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
