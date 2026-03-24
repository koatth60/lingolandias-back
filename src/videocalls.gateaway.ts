import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatsRepository } from './chat/chats.repository';
import { Chat } from './chat/entities/chat.entity';
import { Injectable, OnModuleInit, Scope } from '@nestjs/common';
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

const MAX_MESSAGE_LENGTH = 4000;
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const RATE_LIMIT_MAX = 20;           // max messages per window

@Injectable({ scope: Scope.DEFAULT })
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class VideoCallsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
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
  // Rate limiting: socketId → { count, resetAt }
  private readonly rateLimitMap = new Map<string, { count: number; resetAt: number }>();

  @WebSocketServer() server: Server;

  constructor(
    private readonly chatsRepository: ChatsRepository,
    private readonly unreadCounterService: UnreadCounterService,
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit() {
    try {
      await this.userRepo.update({} as any, { online: 'offline' } as any);
    } catch (_) {}
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private verifySocketToken(socket: Socket): boolean {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) return false;
    try {
      const payload = this.jwtService.verify(token, { secret: process.env.JWT_SECRET });
      socket.data.userId = payload.sub || payload.id;
      socket.data.authenticated = true;
      return true;
    } catch {
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
  handleJoinRoom(socket: Socket, data: { username: string; room: string }) {
    try {
      if (!this.isValidRoom(data.room)) return;

      const userId = this.socketToUser.get(socket.id);
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
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidRoom(data.room)) return;
      if (this.isRateLimited(socket.id)) return;

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
    } catch (_) {}
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
      if (!this.isAuthenticated(socket)) return;
      if (!this.isValidRoom(data.room)) return;
      if (this.isRateLimited(socket.id)) return;

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
    } catch (_) {}
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
