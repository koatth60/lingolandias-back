import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatsRepository } from './chat/chats.repository';
import { Chat } from './chat/entities/chat.entity';
import { Injectable, Logger, OnModuleInit, Scope } from '@nestjs/common';
import { GlobalChat } from './chat/entities/global-chat.entity';
import {
  CounterStrategy,
  generalLanguageStrategy,
  randomRoomStrategy,
  supportRoomStrategy,
  teacherLanguageStrategy,
} from './chat/strategies/counter-strategies';
import { UnreadCounterService } from './chat/unread-counter.service';
import { CounterField } from './chat/types';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './users/entities/user.entity';
import { JwtService } from '@nestjs/jwt';
import { ConversationsRepository } from './conversations/conversations.repository';
import { PushService } from './push/push.service';
import { ScheduleBroadcaster } from './gateway/schedule-broadcaster.service';

const MAX_MESSAGE_LENGTH = 4000;
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const RATE_LIMIT_MAX = 20;           // max messages per window
// Comfortably covers Jitsi/XMPP presence-propagation lag (typically well
// under a second, occasionally a couple) between two near-simultaneous
// joiners each thinking they're first, without risking swallowing a
// genuinely new call placed to the same room minutes later.
const CALL_START_DEDUP_WINDOW_MS = 10_000;

@Injectable({ scope: Scope.DEFAULT })
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class VideoCallsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnGatewayInit
{
  private readonly logger = new Logger(VideoCallsGateway.name);

  private readonly counterStrategies: CounterStrategy[] = [
    supportRoomStrategy,
    generalLanguageStrategy,
    teacherLanguageStrategy,
    randomRoomStrategy,
  ];
  private readonly validLanguages = new Set(['english', 'spanish', 'polish']);
  private readonly uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  private readonly validRoomRegex =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|uuid-[a-z-]+)$/i;

  // socket presence tracking: socketId → userId, userId → Set<socketId>
  private readonly socketToUser = new Map<string, string>();
  private readonly userSockets = new Map<string, Set<string>>();
  // Grace-period timers: userId → timer
  private readonly offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Room membership: roomId → Set<userId>
  private readonly roomMembers = new Map<string, Set<string>>();
  // Last callStarted timestamp per conversationId — guards against the race
  // where two people join a 1:1 within moments of each other and each one's
  // own Jitsi client still sees an empty room (participant-list propagation
  // hasn't caught up yet), so BOTH fire callStarted and the other side who's
  // already in the call gets rung again. Client-side timing can't fix this
  // reliably since it depends on Jitsi/XMPP presence propagation delay, not
  // anything either browser controls — deduping here, where every call-start
  // for a room passes through one place, does.
  private readonly recentCallStarts = new Map<string, number>();
  // Rate limiting: socketId → { count, resetAt }
  private readonly rateLimitMap = new Map<string, { count: number; resetAt: number }>();

  @WebSocketServer() server: Server;

  constructor(
    private readonly chatsRepository: ChatsRepository,
    private readonly unreadCounterService: UnreadCounterService,
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly conversationsRepository: ConversationsRepository,
    private readonly pushService: PushService,
    private readonly scheduleBroadcaster: ScheduleBroadcaster,
  ) {}

  async onModuleInit() {
    try {
      await this.userRepo.update({} as any, { online: 'offline' } as any);
    } catch (_) {}
  }

  // Hands ConversationsRepository a way to push live schedule updates (class
  // renamed, member added/removed) without importing this whole gateway —
  // see ScheduleBroadcaster's own comment for why this indirection exists.
  afterInit(server: Server) {
    this.scheduleBroadcaster.attach(server);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private verifySocketToken(socket: Socket): boolean {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      this.logger.warn(`[auth] socket=${socket.id} NO TOKEN in handshake (auth.token=${JSON.stringify(socket.handshake.auth?.token)}, header=${socket.handshake.headers?.authorization ? 'present' : 'absent'})`);
      return false;
    }
    try {
      const payload = this.jwtService.verify(token, { secret: process.env.JWT_SECRET });
      socket.data.userId = payload.sub || payload.id;
      socket.data.authenticated = true;
      return true;
    } catch (err) {
      this.logger.warn(`[auth] socket=${socket.id} TOKEN REJECTED: ${err?.message} (token prefix: ${token.slice(0, 20)}...)`);
      socket.data.authenticated = false;
      return false;
    }
  }

  private isAuthenticated(socket: Socket): boolean {
    return socket.data?.authenticated === true;
  }

  private isRateLimited(socketId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(socketId);
    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(socketId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return false;
    }
    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX) return true;
    return false;
  }

  private sanitizeMessage(text: string): string {
    if (!text) return '';
    return text.slice(0, MAX_MESSAGE_LENGTH);
  }

  // Mentions are written into the message text itself as @[Display
  // Name](userId) — the frontend inserts this when someone is picked from
  // the @ autocomplete, and renders it back into a styled chip on display.
  // This is the one place that markup gets turned into an actual list of
  // who to notify; see the caller for why it's parsed from the text rather
  // than trusted from a client-supplied array.
  private extractMentionedUserIds(text: string): string[] {
    const matches = text.matchAll(/@\[[^\]]*\]\(([0-9a-f-]{36})\)/g);
    return [...new Set([...matches].map((m) => m[1]))];
  }

  private isValidRoom(room: string): boolean {
    return typeof room === 'string' && this.validRoomRegex.test(room);
  }

  private isValidUUID(uuid: string): boolean {
    return typeof uuid === 'string' && this.uuidRegex.test(uuid);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  handleConnection(socket: Socket) {
    this.verifySocketToken(socket);
  }

  // socketToUser is only populated by the 'registerUser' event, but
  // CallChatWindow's and the legacy ChatWindow's own dedicated socket
  // connections authenticate via handshake token and never emit
  // 'registerUser' at all — resolving purely through socketToUser left them
  // with no known userId, so canJoinRoom's membership check always failed
  // and socket.join was silently skipped, breaking live message delivery
  // for anyone chatting from inside a video call. socket.data.userId (set
  // by verifySocketToken above) covers exactly that gap without touching
  // userSockets/isFirstSocket bookkeeping used for online-status broadcasts.
  private resolveSocketUserId(socket: Socket): string | undefined {
    return this.socketToUser.get(socket.id) || socket.data?.userId;
  }

  async handleDisconnect(socket: Socket) {
    const userId = this.socketToUser.get(socket.id);
    if (!userId) return;

    this.rateLimitMap.delete(socket.id);
    this.socketToUser.delete(socket.id);
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
        const timer = setTimeout(async () => {
          this.offlineTimers.delete(userId);
          if (!this.userSockets.has(userId)) {
            for (const [room, members] of this.roomMembers.entries()) {
              members.delete(userId);
              if (members.size === 0) this.roomMembers.delete(room);
            }
            try {
              const user = await this.userRepo.findOne({ where: { id: userId } });
              if (user) {
                user.online = 'offline';
                await this.userRepo.save(user);
                this.server.emit('userStatus', {
                  id: user.id, online: 'offline', name: user.name + ' ' + user.lastName,
                });
              }
            } catch (_) {}
          }
        }, 7000);
        this.offlineTimers.set(userId, timer);
      }
    }
  }

  @SubscribeMessage('registerUser')
  async handleRegisterUser(socket: Socket, data: { userId: string }) {
    const { userId } = data;
    if (!userId) return;

    // Re-verify token here in case handshake token wasn't provided (legacy clients)
    if (!this.isAuthenticated(socket)) {
      this.verifySocketToken(socket);
    }

    let suppressOnline = false;
    if (this.offlineTimers.has(userId)) {
      clearTimeout(this.offlineTimers.get(userId));
      this.offlineTimers.delete(userId);
      suppressOnline = true;
    }

    const isFirstSocket = !this.userSockets.has(userId) || this.userSockets.get(userId).size === 0;

    this.socketToUser.set(socket.id, userId);
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socket.id);

    if (isFirstSocket && !suppressOnline) {
      try {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (user) {
          user.online = 'online';
          await this.userRepo.save(user);
          this.server.emit('userStatus', {
            id: user.id, online: 'online', name: user.name + ' ' + user.lastName,
          });
        }
      } catch (_) {}
    }
  }

  notifyUserOnline(user: any) {
    this.server.emit('userStatus', { id: user.id, online: 'online', name: user.name });
  }

  notifyUserOffline(user: any) {
    this.server.emit('userStatus', { id: user.id, online: 'offline', name: user.name });
  }

  notifyScheduleUpdated(payload: {
    studentId: string; action: 'add' | 'remove' | 'modify'; schedule?: any; eventIds?: string[];
  }) {
    this.server.emit('scheduleUpdated', payload);
  }

  notifyStudentAssigned(payload: {
    teacherId: string; studentId: string; schedules: any[]; student: any; teacher: any;
  }) {
    this.server.emit('studentAssigned', payload);
  }

  notifyStudentRemoved(payload: {
    teacherId: string; studentIds: string[]; deletedScheduleIds: string[];
  }) {
    this.server.emit('studentRemoved', payload);
  }

  @SubscribeMessage('join')
  async handleJoinRoom(socket: Socket, data: { username: string; room: string }) {
    try {
      if (!this.isValidRoom(data.room)) return;

      const userId = this.resolveSocketUserId(socket);
      // Legacy DM conversations were migrated with their id set to one of
      // the participants' own userId, so a raw room string can collide with
      // a real conversation. Block joining any tracked conversation the
      // caller isn't actually a member of (video-call rooms that aren't
      // Conversation rows are unaffected).
      if (!userId || !(await this.conversationsRepository.canJoinRoom(data.room, userId))) {
        socket.emit('chatError', { reason: 'not_a_member' });
        return;
      }
      if (userId) {
        if (!this.roomMembers.has(data.room)) {
          this.roomMembers.set(data.room, new Set());
        }
        this.roomMembers.get(data.room).add(userId);
      }

      const rooms = Array.from(socket.rooms);
      rooms.forEach((room) => { if (room !== socket.id) socket.leave(room); });

      socket.join(data.room);
      socket.broadcast.to(data.room).emit('ready', { username: data.username });
    } catch (_) {}
  }

  @SubscribeMessage('data')
  handleWebRTCSignaling(socket: Socket, data: any) {
    const { type, room } = data;
    if (['offer', 'answer', 'candidate'].includes(type)) {
      socket.broadcast.to(room).emit('data', data);
    }
  }

  @SubscribeMessage('typing')
  handleTyping(socket: Socket, data: { room: string; username: string }) {
    if (!this.isValidRoom(data.room)) return;
    socket.broadcast.to(data.room).emit('typing', { username: data.username });
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(socket: Socket, data: { room: string }) {
    if (!this.isValidRoom(data.room)) return;
    socket.broadcast.to(data.room).emit('stopTyping', {});
  }

  @SubscribeMessage('getRoomMembers')
  async handleGetRoomMembers(socket: Socket, data: { room: string }) {
    try {
      if (!this.isValidRoom(data.room)) {
        socket.emit('roomMembers', { room: data.room, members: [] });
        return;
      }
      const userId = this.resolveSocketUserId(socket);
      if (!userId || !(await this.conversationsRepository.canJoinRoom(data.room, userId))) {
        socket.emit('roomMembers', { room: data.room, members: [] });
        return;
      }
      const socketIds = this.server.sockets.adapter.rooms.get(data.room);
      if (!socketIds) {
        socket.emit('roomMembers', { room: data.room, members: [] });
        return;
      }
      const userIds = new Set<string>();
      socketIds.forEach((sid) => {
        const uid = this.socketToUser.get(sid);
        if (uid) userIds.add(uid);
      });
      const users = await this.userRepo.find({
        where: { id: In([...userIds]) },
        select: ['id', 'name', 'lastName', 'language', 'avatarUrl'] as any,
      });
      const members = users.map((user) => ({
        id: (user as any).id,
        name: (user as any).name,
        language: (user as any).language || 'english',
        avatarUrl: (user as any).avatarUrl,
      }));
      socket.emit('roomMembers', { room: data.room, members });
    } catch (_) {}
  }

  @SubscribeMessage('editNormalChat')
  async handleEditNormalChat(
    socket: Socket,
    data: { messageId: string; room: string; newMessage: string },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidUUID(data.messageId) || !this.isValidRoom(data.room)) return;
      const safe = this.sanitizeMessage(data.newMessage);
      if (!safe.trim()) return;
      await this.chatsRepository.editNormalChat(data.messageId, safe);
      this.server.to(data.room).emit('normalChatEdited', { messageId: data.messageId, newMessage: safe });
    } catch (_) {}
  }

  @SubscribeMessage('editGlobalChat')
  async handleEditGlobalChat(
    socket: Socket,
    data: { messageId: string; room: string; newMessage: string },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidUUID(data.messageId) || !this.isValidRoom(data.room)) return;
      const safe = this.sanitizeMessage(data.newMessage);
      if (!safe.trim()) return;
      await this.chatsRepository.editGlobalChat(data.messageId, safe);
      this.server.to(data.room).emit('globalChatEdited', { messageId: data.messageId, newMessage: safe });
    } catch (_) {}
  }

  @SubscribeMessage('clearNormalChat')
  async handleClearNormalChat(socket: Socket, data: { room: string }) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidRoom(data.room)) return;
      await this.chatsRepository.deleteChatsByRoom(data.room);
      this.server.to(data.room).emit('normalChatCleared', { room: data.room });
    } catch (_) {}
  }

  @SubscribeMessage('notifyRead')
  handleNotifyRead(socket: Socket, data: { room: string }) {
    if (!this.isValidRoom(data.room)) return;
    socket.broadcast.to(data.room).emit('chatMessagesRead', { room: data.room });

    const members = this.roomMembers.get(data.room);
    if (members) {
      for (const memberId of members) {
        const memberSockets = this.userSockets.get(memberId);
        if (memberSockets) {
          for (const sid of memberSockets) {
            if (sid !== socket.id) {
              this.server.to(sid).emit('chatMessagesRead', { room: data.room });
            }
          }
        }
      }
    }
  }

  @SubscribeMessage('deleteGlobalChat')
  async handleDeleteGlobalChat(socket: Socket, data: { messageId: string; room: string }) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidUUID(data.messageId) || !this.isValidRoom(data.room)) return;
      await this.chatsRepository.deleteGlobalChat(data.messageId);
      this.server.to(data.room).emit('globalChatDeleted', { messageId: data.messageId });
    } catch (_) {}
  }

  @SubscribeMessage('deleteNormalChat')
  async handleDeleteNormalChat(socket: Socket, data: { messageId: string; room: string }) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidUUID(data.messageId) || !this.isValidRoom(data.room)) return;
      await this.chatsRepository.deleteNormalChat(data.messageId);
      this.server.to(data.room).emit('normalChatDeleted', { messageId: data.messageId });
    } catch (_) {}
  }

  @SubscribeMessage('chat')
  async handleChat(
    socket: Socket,
    data: {
      username: string;
      email: string;
      room: string;
      message: string;
      userUrl?: string;
      replyTo?: { id: string; message: string; username: string } | null;
    },
  ) {
    try {
      if (!this.isAuthenticated(socket)) {
        this.logger.warn(
          `chatError not_authenticated room=${data?.room} email=${data?.email} socket=${socket.id}`,
        );
        socket.emit('chatError', { reason: 'not_authenticated' });
        return;
      }
      if (!this.isValidRoom(data.room)) return;
      if (this.isRateLimited(socket.id)) {
        this.logger.warn(
          `chatError rate_limited room=${data?.room} email=${data?.email} socket=${socket.id}`,
        );
        socket.emit('chatError', { reason: 'rate_limited' });
        return;
      }

      const safe = this.sanitizeMessage(data.message);

      const chatData = new Chat();
      chatData.username = data.username?.slice(0, 100) || 'User';
      chatData.email = data.email?.slice(0, 200) || '';
      chatData.room = data.room;
      chatData.message = safe;
      chatData.timestamp = new Date();
      if (data.userUrl) chatData.userUrl = data.userUrl;
      if (data.replyTo) chatData.replyTo = data.replyTo;

      await this.chatsRepository.saveChat(chatData);
      this.server.to(data.room).emit('chat', chatData);

      // Include preview in broadcast so chat list can show last message
      const preview = safe.startsWith('http') ? '📎 File' : safe.slice(0, 80);
      socket.broadcast.emit('newChat', {
        room: data.room,
        preview,
        sender: chatData.username,
      });
    } catch (err) {
      this.logger.error(
        `handleChat error room=${data?.room} email=${data?.email} socket=${socket.id}`,
        err,
      );
      socket.emit('chatError', { reason: 'server_error' });
    }
  }

  @SubscribeMessage('globalChat')
  async handleGlobalChat(
    socket: Socket,
    data: {
      username: string;
      email: string;
      room: string;
      message: string;
      userUrl?: string;
      fileUrl?: string;
    },
  ) {
    try {
      if (!this.isAuthenticated(socket)) {
        this.logger.warn(
          `chatError not_authenticated room=${data?.room} email=${data?.email} socket=${socket.id}`,
        );
        socket.emit('chatError', { reason: 'not_authenticated' });
        return;
      }
      if (!this.isValidRoom(data.room)) return;
      if (this.isRateLimited(socket.id)) {
        this.logger.warn(
          `chatError rate_limited room=${data?.room} email=${data?.email} socket=${socket.id}`,
        );
        socket.emit('chatError', { reason: 'rate_limited' });
        return;
      }

      const safe = this.sanitizeMessage(data.message);

      const globalChatData = new GlobalChat();
      globalChatData.username = data.username?.slice(0, 100) || 'User';
      globalChatData.email = data.email?.slice(0, 200) || '';
      globalChatData.room = data.room;
      globalChatData.message = safe;
      globalChatData.timestamp = new Date();
      if (data.userUrl) globalChatData.userUrl = data.userUrl;
      if (data.fileUrl) globalChatData.fileUrl = data.fileUrl;

      await this.chatsRepository.saveGlobalChat(globalChatData);

      const strategy = this.counterStrategies.find((s) => s.roomPattern.test(data.room));
      if (strategy) {
        const counterField = this.getCounterField(data.room);
        await this.unreadCounterService.bulkIncrementCounter(
          counterField,
          (qb) => strategy.applyConditions(qb, data.room),
          data.email,
        );
      }

      this.server.to(data.room).emit('globalChat', globalChatData);

      // Include preview in broadcast so chat list can show last message
      const preview = data.fileUrl ? '📎 File' : safe.slice(0, 80);
      socket.broadcast.emit('newUnreadGlobalMessage', {
        room: data.room,
        preview,
        sender: globalChatData.username,
      });
    } catch (err) {
      this.logger.error(
        `handleGlobalChat error room=${data?.room} email=${data?.email} socket=${socket.id}`,
        err,
      );
      socket.emit('chatError', { reason: 'server_error' });
    }
  }

  @SubscribeMessage('supportChat')
  async handleSupportChat(
    socket: Socket,
    data: {
      username: string;
      email: string;
      room: string;
      message: string;
      userRole?: string;
      userUrl?: string;
    },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (this.isRateLimited(socket.id)) return;

      const safe = this.sanitizeMessage(data.message);

      const globalChatData = new GlobalChat();
      globalChatData.username = data.username?.slice(0, 100) || 'User';
      globalChatData.email = data.email?.slice(0, 200) || '';
      globalChatData.room = 'uuid-support';
      globalChatData.message = safe;
      globalChatData.timestamp = new Date();
      if (data.userRole) globalChatData.userRole = data.userRole;
      if (data.userUrl) globalChatData.userUrl = data.userUrl;

      await this.chatsRepository.saveGlobalChat(globalChatData);

      await this.unreadCounterService.bulkIncrementCounter(
        'supportRoom',
        (qb) => supportRoomStrategy.applyConditions(qb, 'uuid-support'),
        data.email,
      );

      this.server.to('uuid-support').emit('supportChat', globalChatData);
      socket.broadcast.emit('newUnreadSupportMessage', { room: 'uuid-support' });
    } catch (_) {}
  }

  @SubscribeMessage('deleteSupportChat')
  async handleDeleteSupportChat(socket: Socket, data: { messageId: string }) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidUUID(data.messageId)) return;
      await this.chatsRepository.deleteGlobalChat(data.messageId);
      this.server.to('uuid-support').emit('supportChatDeleted', { messageId: data.messageId });
    } catch (_) {}
  }

  // ── Unified conversation model (Teams-style overhaul) ───────────────────
  // Reuses the existing 'join'/'typing'/'stopTyping' handlers above as-is —
  // they already operate on any validated room string, and a conversation id
  // (whether a legacy fixed string or a freshly generated UUID) passes the
  // same isValidRoom() check. Only sending/editing/deleting messages needs
  // new handlers, since those write to the new `messages` table instead of
  // `chats`/`global-chats`.

  // Admins can join any class from the admin dashboard to observe, but are
  // never an actual call participant — ringing them for every class that
  // starts platform-wide would be constant noise. Used everywhere callStarted
  // resolves a recipient list, both the 1:1 and group-conversation branches.
  private async excludeAdmins(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return userIds;
    const admins = await this.userRepo.find({ where: { id: In(userIds), role: 'admin' }, select: ['id'] });
    if (!admins.length) return userIds;
    const adminIds = new Set(admins.map((a) => a.id));
    return userIds.filter((id) => !adminIds.has(id));
  }

  // Fire-and-forget alongside emitToUsers — reaches a subscribed browser
  // even fully closed, unlike the socket event alone. Never awaited by the
  // caller: a slow/failing push provider shouldn't delay the in-app ring.
  private pushCallNotification(
    userIds: string[],
    payload: { conversationId: string; callerId: string; callerName: string; chatName: string; chatType: string },
  ) {
    for (const userId of userIds) {
      this.pushService
        .sendCallNotification(userId, {
          callerName: payload.callerName,
          chatName: payload.chatName,
          chatType: payload.chatType,
          conversationId: payload.conversationId,
          callerId: payload.callerId,
        })
        .catch((err) => this.logger.error(`[callStarted] push failed for userId=${userId}: ${err?.message}`));
    }
  }

  // Filters recipientIds down to members who opted into messageNotifications
  // and haven't muted this conversation, then fires a push to each.
  private async sendNewMessagePushes(
    conversationId: string,
    recipientIds: string[],
    senderName: string,
    preview: string,
  ) {
    if (!recipientIds.length) return;
    const [mutedByUserId, recipients, conversation] = await Promise.all([
      this.conversationsRepository.getMuteStatusByUserId(conversationId),
      this.userRepo.find({ where: { id: In(recipientIds) }, relations: ['settings'] }),
      this.conversationsRepository.getConversationBasic(conversationId),
    ]);
    const chatName = conversation?.type === 'group' ? conversation.name : undefined;
    for (const recipient of recipients) {
      if (mutedByUserId.get(recipient.id)) continue;
      if (!recipient.settings?.messageNotifications) continue;
      await this.pushService.sendNewMessagePush(recipient.id, { senderName, preview, chatName });
    }
  }

  private emitToUsers(userIds: string[], event: string, payload: any) {
    for (const userId of userIds) {
      const socketIds = this.userSockets.get(userId);
      if (event === 'callStarted') {
        this.logger.warn(`[emitToUsers] userId=${userId} socketIds=${socketIds ? JSON.stringify([...socketIds]) : 'NONE'}`);
      }
      if (!socketIds) continue;
      for (const socketId of socketIds) {
        this.server.to(socketId).emit(event, payload);
      }
    }
  }

  @SubscribeMessage('sendConversationMessage')
  async handleSendConversationMessage(
    socket: Socket,
    data: {
      conversationId: string;
      senderId: string;
      username: string;
      email: string;
      avatarUrl?: string;
      message: string;
      fileUrl?: string;
      userUrl?: string;
      userRole?: string;
      replyTo?: { id: string; message: string; username: string } | null;
      messageType?: string;
    },
  ) {
    try {
      if (!this.isAuthenticated(socket)) {
        socket.emit('chatError', { reason: 'not_authenticated' });
        return;
      }
      if (!this.isValidRoom(data.conversationId)) return;
      if (this.isRateLimited(socket.id)) {
        socket.emit('chatError', { reason: 'rate_limited' });
        return;
      }
      const isMember = await this.conversationsRepository.isMember(data.conversationId, data.senderId);
      if (!isMember) {
        socket.emit('chatError', { reason: 'not_a_member' });
        return;
      }

      const safe = this.sanitizeMessage(data.message);
      // Fetched before saving so the mention filter below can use it too —
      // needed either way for the newConversationMessage/push fan-out.
      const memberIds = await this.conversationsRepository.getMemberIds(data.conversationId);
      // Parsed from the message text itself, never taken from the client's
      // own claim of who it mentioned — a client could otherwise trigger a
      // "you were mentioned" push at anyone by just sending their id, mention
      // markup or not. Filtered to actual current members: mentioning
      // someone not in this conversation isn't a real mention (yet — auto-
      // adding a mentioned non-member is a separate, not-yet-built feature).
      const mentionedUserIds = this.extractMentionedUserIds(safe).filter(
        (id) => id !== data.senderId && memberIds.includes(id),
      );
      const saved = await this.conversationsRepository.saveMessage({
        conversationId: data.conversationId,
        senderId: data.senderId,
        username: data.username?.slice(0, 100) || 'User',
        email: data.email?.slice(0, 200) || '',
        avatarUrl: data.avatarUrl,
        message: safe,
        fileUrl: data.fileUrl,
        userUrl: data.userUrl,
        userRole: data.userRole,
        replyTo: data.replyTo || null,
        messageType: data.messageType === 'missed_call' ? 'missed_call' : undefined,
        mentionedUserIds: mentionedUserIds.length ? mentionedUserIds : null,
        timestamp: new Date(),
      });

      this.server.to(data.conversationId).emit('conversationMessage', saved);

      // Notify every member's personal sockets (not just those with the room
      // open) so their conversation list preview/unread badge updates live.
      // Strip @[Name](id) mention markup first — this same preview also feeds
      // the "mentioned" toast and the push notification body, neither of
      // which should show raw markup.
      const preview = data.fileUrl ? '📎 File' : safe.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1').slice(0, 80);
      const recipientIds = memberIds.filter((id) => id !== data.senderId);
      this.emitToUsers(recipientIds, 'newConversationMessage', {
        conversationId: data.conversationId,
        preview,
        sender: saved.username,
      });

      // OS push notification — reaches a recipient even with the tab/browser
      // fully closed, same idea as pushCallNotification. Only for members who
      // opted in AND haven't muted this specific conversation; fire-and-forget
      // so a slow/failing push never delays message delivery to the sender.
      this.sendNewMessagePushes(data.conversationId, recipientIds, saved.username, preview).catch((err) =>
        this.logger.error(`sendNewMessagePushes failed conversationId=${data?.conversationId}`, err),
      );

      // Mention notifications are deliberately separate from (and in
      // addition to) the general new-message push above — someone who muted
      // this conversation, or never opted into messageNotifications at all,
      // still gets pinged when it's actually about them. In-app toast via
      // socket for anyone online right now; push covers a closed tab too.
      if (mentionedUserIds.length) {
        this.emitToUsers(mentionedUserIds, 'mentioned', {
          conversationId: data.conversationId,
          senderName: saved.username,
          preview,
        });
        for (const userId of mentionedUserIds) {
          this.pushService
            .sendMentionPush(userId, { senderName: saved.username, preview, conversationId: data.conversationId })
            .catch((err) => this.logger.error(`sendMentionPush failed userId=${userId}`, err));
        }
      }
    } catch (err) {
      this.logger.error(
        `handleSendConversationMessage error conversationId=${data?.conversationId} socket=${socket.id}`,
        err,
      );
      socket.emit('chatError', { reason: 'server_error' });
    }
  }

  @SubscribeMessage('markConversationRead')
  async handleMarkConversationRead(
    socket: Socket,
    data: { conversationId: string; userId: string },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidRoom(data.conversationId)) return;
      const isMember = await this.conversationsRepository.isMember(data.conversationId, data.userId);
      if (!isMember) return;
      const readAt = new Date();
      await this.conversationsRepository.markRead(data.conversationId, data.userId);
      // Broadcast so the sender's open chat window can flip their message to
      // "read" live, the way Teams/WhatsApp do — everyone in the room gets
      // this, including the reader themselves, which is harmless (their own
      // read state doesn't render anything).
      this.server.to(data.conversationId).emit('conversationRead', {
        conversationId: data.conversationId,
        userId: data.userId,
        readAt,
      });
      // Also reach the reader's OTHER sessions directly (sidebar badge, chat
      // list, a different tab) — none of those necessarily joined this
      // conversation's own socket room, only an open ChatWindowComponent does.
      // Without this, an unread badge that was bumped by the arriving message
      // (see handleSendConversationMessage) never learns it was read until
      // some unrelated future event forces a full refetch.
      this.emitToUsers([data.userId], 'conversationRead', {
        conversationId: data.conversationId,
        userId: data.userId,
        readAt,
      });
    } catch (_) {}
  }

  @SubscribeMessage('editConversationMessage')
  async handleEditConversationMessage(
    socket: Socket,
    data: { messageId: string; conversationId: string; newMessage: string },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidUUID(data.messageId) || !this.isValidRoom(data.conversationId)) return;
      const safe = this.sanitizeMessage(data.newMessage);
      if (!safe.trim()) return;
      const editedAt = new Date();
      await this.conversationsRepository.editMessage(data.messageId, safe, editedAt);
      this.server.to(data.conversationId).emit('conversationMessageEdited', {
        messageId: data.messageId,
        newMessage: safe,
        editedAt,
      });
    } catch (_) {}
  }

  @SubscribeMessage('deleteConversationMessage')
  async handleDeleteConversationMessage(
    socket: Socket,
    data: { messageId: string; conversationId: string },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidUUID(data.messageId) || !this.isValidRoom(data.conversationId)) return;
      await this.conversationsRepository.deleteMessage(data.messageId);
      this.server.to(data.conversationId).emit('conversationMessageDeleted', {
        messageId: data.messageId,
      });
    } catch (_) {}
  }

  @SubscribeMessage('toggleReaction')
  async handleToggleReaction(
    socket: Socket,
    data: { conversationId: string; messageId: string; emoji: string; userName?: string },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidUUID(data.messageId) || !this.isValidRoom(data.conversationId)) return;
      const userId = this.resolveSocketUserId(socket);
      if (!userId) return;
      const isMember = await this.conversationsRepository.isMember(data.conversationId, userId);
      if (!isMember) return;
      const emoji = (data.emoji || '').trim().slice(0, 8);
      if (!emoji) return;
      const userName = (data.userName || '').trim().slice(0, 100) || 'Someone';
      const reactions = await this.conversationsRepository.toggleReaction(data.messageId, userId, userName, emoji);
      this.server.to(data.conversationId).emit('messageReactionUpdated', {
        conversationId: data.conversationId,
        messageId: data.messageId,
        reactions,
      });
    } catch (_) {}
  }

  @SubscribeMessage('newConversationCreated')
  async handleNewConversationCreated(
    socket: Socket,
    data: { conversationId: string; memberIds: string[] },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      this.emitToUsers(data.memberIds, 'newConversation', { conversationId: data.conversationId });
    } catch (_) {}
  }

  // Fired by the client that just hard-deleted a group (see DELETE
  // /conversations/:id/group) so every OTHER member's chat list drops it
  // live instead of only updating for whoever clicked delete.
  @SubscribeMessage('conversationDeleted')
  async handleConversationDeleted(
    socket: Socket,
    data: { conversationId: string; memberIds: string[] },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      this.emitToUsers(data.memberIds, 'newConversation', { conversationId: data.conversationId });
    } catch (_) {}
  }

  // Fired by the first participant to join a call (see JitsiClassRoom.jsx,
  // which only emits this when it finds itself alone in the room) so the
  // other side gets a real "incoming call" banner with ringtone — Accept
  // jumps straight into the same room, Decline just dismisses it.
  //
  // Two delivery paths:
  // - otherUserId given (DM, or a scheduled 1:1 class joined from Schedule
  //   where roomId doesn't always correspond to a real conversations row):
  //   notify that one person directly, no DB lookup needed.
  // - otherwise (group): resolve members from conversation_members and
  //   notify everyone but the caller.
  @SubscribeMessage('callStarted')
  async handleCallStarted(
    socket: Socket,
    data: {
      conversationId: string;
      callerId: string;
      callerName: string;
      chatName: string;
      chatType: string;
      otherUserId?: string;
    },
  ) {
    try {
      if (!this.isAuthenticated(socket)) {
        this.logger.warn(`[callStarted] rejected: socket not authenticated (socket=${socket.id})`);
        return;
      }
      const now = Date.now();
      const lastCallStart = this.recentCallStarts.get(data.conversationId);
      if (lastCallStart && now - lastCallStart < CALL_START_DEDUP_WINDOW_MS) {
        this.logger.warn(`[callStarted] deduped: conversationId=${data.conversationId} caller=${data.callerId} (ringed ${now - lastCallStart}ms ago)`);
        return;
      }
      this.recentCallStarts.set(data.conversationId, now);
      const payload = {
        conversationId: data.conversationId,
        callerId: data.callerId,
        callerName: data.callerName?.slice(0, 100) || 'Someone',
        chatName: data.chatName?.slice(0, 100) || '',
        chatType: data.chatType,
      };
      if (data.otherUserId) {
        const recipients = await this.excludeAdmins([data.otherUserId]);
        if (recipients.length) {
          this.logger.warn(`[callStarted] 1:1 notify otherUserId=${data.otherUserId} caller=${data.callerId}`);
          this.emitToUsers(recipients, 'callStarted', payload);
          this.pushCallNotification(recipients, payload);
        }
        return;
      }
      if (!this.isValidRoom(data.conversationId)) {
        this.logger.warn(`[callStarted] rejected: invalid room conversationId=${data.conversationId}`);
        return;
      }
      const isMember = await this.conversationsRepository.isMember(data.conversationId, data.callerId);
      if (!isMember) {
        this.logger.warn(`[callStarted] rejected: caller=${data.callerId} not a member of conversationId=${data.conversationId}`);
        return;
      }
      const memberIds = await this.conversationsRepository.getMemberIds(data.conversationId);
      // Admins can join any class to observe from the admin dashboard, but
      // must never be rung like an actual call participant — they're a
      // silent observer, not part of the call.
      const targets = await this.excludeAdmins(memberIds.filter((id) => id !== data.callerId));
      this.logger.warn(`[callStarted] group notify targets=${JSON.stringify(targets)} caller=${data.callerId} conversationId=${data.conversationId}`);
      this.emitToUsers(targets, 'callStarted', payload);
      this.pushCallNotification(targets, payload);
    } catch (err) {
      this.logger.error(`[callStarted] error: ${err?.message}`, err?.stack);
    }
  }

  // 1:1 only (see IncomingCallBanner) — lets the caller log "missed call"
  // the moment the other side actively declines, instead of only finding
  // out CALL_RING_TIMEOUT_MS later when their own client re-checks
  // participant count.
  @SubscribeMessage('callDeclined')
  async handleCallDeclined(
    socket: Socket,
    data: { conversationId: string; callerId: string; calleeId: string },
  ) {
    try {
      if (!this.isAuthenticated(socket)) return;
      if (!data.callerId) return;
      this.emitToUsers([data.callerId], 'callDeclined', {
        conversationId: data.conversationId,
        calleeId: data.calleeId,
      });
    } catch (_) {}
  }

  private getCounterField(room: string): CounterField {
    if (room === 'uuid-support') return 'supportRoom';
    if (room.startsWith('uuid-teacher-')) {
      const lang = room.split('-')[2];
      return `teachers${this.capitalize(lang)}Room` as CounterField;
    }
    if (room.startsWith('uuid-')) {
      const lang = room.split('-')[1];
      return `general${this.capitalize(lang)}Room` as CounterField;
    }
    return 'randomRoom';
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
