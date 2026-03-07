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
import { Repository } from 'typeorm';
import { User } from './users/entities/user.entity';

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

  // socket presence tracking: socketId → userId, userId → Set<socketId>
  private readonly socketToUser = new Map<string, string>();
  private readonly userSockets = new Map<string, Set<string>>();

  @WebSocketServer() server: Server;

  constructor(
    private readonly chatsRepository: ChatsRepository,
    private readonly unreadCounterService: UnreadCounterService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit() {
    try {
      await this.userRepo.update({} as any, { online: 'offline' } as any);
    } catch (_) {}
  }

  handleConnection(socket: Socket) {}

  async handleDisconnect(socket: Socket) {
    const userId = this.socketToUser.get(socket.id);
    if (!userId) return;

    this.socketToUser.delete(socket.id);
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
        try {
          const user = await this.userRepo.findOne({ where: { id: userId } });
          if (user) {
            user.online = 'offline';
            await this.userRepo.save(user);
            this.server.emit('userStatus', {
              id: user.id,
              online: 'offline',
              name: user.name + ' ' + user.lastName,
            });
          }
        } catch (_) {}
      }
    }
  }

  @SubscribeMessage('registerUser')
  async handleRegisterUser(socket: Socket, data: { userId: string }) {
    const { userId } = data;
    if (!userId) return;

    const isFirstSocket = !this.userSockets.has(userId) || this.userSockets.get(userId).size === 0;

    this.socketToUser.set(socket.id, userId);
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socket.id);

    if (isFirstSocket) {
      try {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (user) {
          user.online = 'online';
          await this.userRepo.save(user);
          this.server.emit('userStatus', {
            id: user.id,
            online: 'online',
            name: user.name + ' ' + user.lastName,
          });
        }
      } catch (_) {}
    }
  }

  notifyUserOnline(user: any) {
    const { id, name } = user;
    this.server.emit('userStatus', { id: id, online: 'online', name: name });
  }

  notifyUserOffline(user: any) {
    const { id, name } = user;
    this.server.emit('userStatus', { id: id, online: 'offline', name: name });
  }

  notifyScheduleUpdated(payload: {
    studentId: string;
    action: 'add' | 'remove' | 'modify';
    schedule?: any;
    eventIds?: string[];
  }) {
    this.server.emit('scheduleUpdated', payload);
  }

  notifyStudentAssigned(payload: {
    teacherId: string;
    studentId: string;
    schedules: any[];
    student: any;
    teacher: any;
  }) {
    this.server.emit('studentAssigned', payload);
  }

  notifyStudentRemoved(payload: {
    teacherId: string;
    studentIds: string[];
    deletedScheduleIds: string[];
  }) {
    this.server.emit('studentRemoved', payload);
  }

  @SubscribeMessage('join')
  handleJoinRoom(socket: Socket, data: { username: string; room: string }) {
    try {

      // Dejar todas las habitaciones excepto la predeterminada (propia del socket)
      const rooms = Array.from(socket.rooms); // Obtén todas las salas a las que pertenece el socket
      rooms.forEach((room) => {
        if (room !== socket.id) {
          socket.leave(room); // Abandona cualquier sala que no sea la propia
        }
      });

      // Unirse a la nueva sala
      socket.join(data.room);

      // Notificar a los usuarios de la nueva sala
      socket.broadcast.to(data.room).emit('ready', { username: data.username });
    } catch (err) {
    }
  }

  @SubscribeMessage('data')
  handleWebRTCSignaling(socket: Socket, data: any) {
    const { type, room } = data;
    if (['offer', 'answer', 'candidate'].includes(type)) {
      socket.broadcast.to(room).emit('data', data);
    } else {
    }
  }

  @SubscribeMessage('editNormalChat')
  async handleEditNormalChat(
    socket: Socket,
    data: { messageId: string; room: string; newMessage: string },
  ) {
    try {
      await this.chatsRepository.editNormalChat(data.messageId, data.newMessage);
      this.server.to(data.room).emit('normalChatEdited', { messageId: data.messageId, newMessage: data.newMessage });
    } catch (err) {}
  }

  @SubscribeMessage('editGlobalChat')
  async handleEditGlobalChat(
    socket: Socket,
    data: { messageId: string; room: string; newMessage: string },
  ) {
    try {
      await this.chatsRepository.editGlobalChat(data.messageId, data.newMessage);
      this.server.to(data.room).emit('globalChatEdited', { messageId: data.messageId, newMessage: data.newMessage });
    } catch (err) {}
  }

  @SubscribeMessage('clearNormalChat')
  async handleClearNormalChat(
    socket: Socket,
    data: { room: string },
  ) {
    try {
      await this.chatsRepository.deleteChatsByRoom(data.room);
      this.server.to(data.room).emit('normalChatCleared', { room: data.room });
    } catch (err) {}
  }

  @SubscribeMessage('notifyRead')
  handleNotifyRead(socket: Socket, data: { room: string }) {
    socket.broadcast.to(data.room).emit('chatMessagesRead', { room: data.room });
  }

  @SubscribeMessage('deleteGlobalChat')
  async handleDeleteGlobalChat(
    socket: Socket,
    data: { messageId: string; room: string },
  ) {
    try {
      // Call repository to delete message
      await this.chatsRepository.deleteGlobalChat(data.messageId);


      // Notify all users in the room that the message has been deleted
      this.server
        .to(data.room)
        .emit('globalChatDeleted', { messageId: data.messageId });
    } catch (err) {
    }
  }

  @SubscribeMessage('deleteNormalChat')
  async handleDeleteNormalChat(
    socket: Socket,
    data: { messageId: string; room: string },
  ) {
    try {
      // Call repository to delete message
      await this.chatsRepository.deleteNormalChat(data.messageId);


      this.server
        .to(data.room)
        .emit('normalChatDeleted', { messageId: data.messageId });
    } catch (err) {
    }
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
    },
  ) {
    try {
      const chatData = new Chat();
      chatData.username = data.username;
      chatData.email = data.email;
      chatData.room = data.room;
      chatData.message = data.message;
      chatData.timestamp = new Date();
      if (data.userUrl) {
        chatData.userUrl = data.userUrl;
      }
      await this.chatsRepository.saveChat(chatData);
      this.server.to(data.room).emit('chat', chatData);
      socket.broadcast.emit('newChat', { room: data.room });
    } catch (err) {
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
    },
  ) {
    try {
      // Create and save the global chat message
      const globalChatData = new GlobalChat();
      globalChatData.username = data.username;
      globalChatData.email = data.email;
      globalChatData.room = data.room;
      globalChatData.message = data.message;
      globalChatData.timestamp = new Date();
      if (data.userUrl) {
        globalChatData.userUrl = data.userUrl;
      }
      await this.chatsRepository.saveGlobalChat(globalChatData);

      // 2. Actualizar contadores usando estrategias
      const strategy = this.counterStrategies.find((s) =>
        s.roomPattern.test(data.room),
      );

      if (strategy) {
        const counterField = this.getCounterField(data.room);
        await this.unreadCounterService.bulkIncrementCounter(
          counterField,
          (qb) => strategy.applyConditions(qb, data.room),
          data.email,
        );
      }
      // Emitir eventos
      this.server.to(data.room).emit('globalChat', globalChatData);
      socket.broadcast.emit('newUnreadGlobalMessage', { room: data.room });
    } catch (err) {
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
      const globalChatData = new GlobalChat();
      globalChatData.username = data.username;
      globalChatData.email = data.email;
      globalChatData.room = 'uuid-support';
      globalChatData.message = data.message;
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
    } catch (err) {}
  }

  @SubscribeMessage('deleteSupportChat')
  async handleDeleteSupportChat(
    socket: Socket,
    data: { messageId: string },
  ) {
    try {
      await this.chatsRepository.deleteGlobalChat(data.messageId);
      this.server.to('uuid-support').emit('supportChatDeleted', { messageId: data.messageId });
    } catch (err) {}
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

  private parseId(input: string): {
    id?: string;
    role?: string;
    language?: string;
  } {
    if (this.isValidUUID(input)) {
      return { id: input };
    }
    if (input.startsWith('uuid-')) {
      const suffix = input.slice(5);
      const parts = suffix.split('-');
      if (parts.length === 1) {
        return { language: parts[0] };
      }
      if (parts.length === 2) {
        return { role: parts[0], language: parts[1] };
      }
    }
  }

  private isValidUUID(uuid: string): boolean {
    return this.uuidRegex.test(uuid);
  }
}
