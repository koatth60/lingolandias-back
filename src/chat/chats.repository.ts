import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from './entities/chat.entity';
import { GlobalChat } from './entities/global-chat.entity';
import { UnreadGlobalMessage } from './entities/unread-global-messages.entity';
import { ArchivedChat } from './entities/archived-chat.entity';

@Injectable()
export class ChatsRepository {
  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(GlobalChat)
    private readonly globalChatRepository: Repository<GlobalChat>,
    @InjectRepository(UnreadGlobalMessage)
    private readonly unreadGlobalChatRepository: Repository<UnreadGlobalMessage>,
    @InjectRepository(ArchivedChat)
    private readonly archivedChatRepository: Repository<ArchivedChat>,
  ) {}

  // Get regular chats for a specific room
  async getChats(room: string): Promise<Chat[]> {
    try {
      return await this.chatRepository
        .createQueryBuilder('chat')
        .where('chat.room = :room', { room })
        .orderBy('chat.timestamp', 'DESC')
        .take(50)
        .getMany();
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch chats');
    }
  }

  // Mark all messages as read for a specific room
  async readChat(room: string, email: string): Promise<void> {
    try {
      await this.chatRepository
        .createQueryBuilder()
        .update(Chat)
        .set({ unread: false })
        .where('room = :room', { room })
        .andWhere('email != :email', { email })
        .execute();
    } catch (error) {
      throw new InternalServerErrorException('Failed to mark messages as read');
    }
  }

  // Get global chats for a specific room
  async getGlobalChats(room: string): Promise<GlobalChat[]> {
    try {
      return await this.globalChatRepository
        .createQueryBuilder('globalChat')
        .where('globalChat.room = :room', { room })
        .orderBy('globalChat.timestamp', 'DESC')
        .take(50)
        .getMany();
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch global chats');
    }
  }

  // Save a regular chat message
  async saveChat(chat: Chat): Promise<Chat> {
    try {
      return await this.chatRepository.save(chat);
    } catch (error) {
      throw new InternalServerErrorException('Failed to save chat');
    }
  }

  // Save a global chat message
  async saveGlobalChat(globalChat: GlobalChat): Promise<GlobalChat> {
    try {
      return await this.globalChatRepository.save(globalChat);
    } catch (error) {
      throw new InternalServerErrorException('Failed to save global chat');
    }
  }

  // Delete a global chat message
  async deleteGlobalChat(id: string): Promise<void> {
    try {
      await this.globalChatRepository.delete(id);
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete global chat');
    }
  }

  // Delete a regular chat message
  async deleteNormalChat(id: string): Promise<void> {
    try {
      await this.chatRepository.delete(id);
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete chat');
    }
  }

  async saveUnreadMessage(body: any) {
    return await this.unreadGlobalChatRepository.save(body);
  }

  async getUnreadGlobalMessages(id: string): Promise<UnreadGlobalMessage[]> {
    try {
      return await this.unreadGlobalChatRepository
        .createQueryBuilder('unreadGlobalMessage')
        .where('unreadGlobalMessage.userId = :id', { id })
        .getMany();
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch unread messages');
    }
  }

  async deleteUnreadGlobalMessages(
    userId: string,
    room: string,
  ): Promise<string> {
    if (!userId || !room) {
      throw new NotFoundException('userId and room are required');
    }

    // Mapeo de las IDs de las rooms con las columnas correspondientes
    const roomMappings = {
      'uuid-english': 'generalEnglishRoom',
      'uuid-spanish': 'generalSpanishRoom',
      'uuid-polish': 'generalPolishRoom',
      'uuid-teacher-english': 'teachersEnglishRoom',
      'uuid-teacher-spanish': 'teachersSpanishRoom',
      'uuid-teacher-polish': 'teachersPolishRoom',
      'uuid-support': 'supportRoom',
    };

    // Asignación de columna según el room mapeado
    let columnToUpdate = roomMappings[room];

    // Si la room no está en el mapeo, se asigna la columna por defecto 'randomRoom'
    if (!columnToUpdate) {
      columnToUpdate = 'randomRoom';
    }

    // Validar si la room tiene un mapeo, si no se usa 'randomRoom'
    if (!columnToUpdate) {
      throw new NotFoundException(`Room with ID ${room} not found`);
    }

    // Buscar al usuario en la base de datos
    const user = await this.unreadGlobalChatRepository.findOne({
      where: { user: { id: userId } },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Actualizar la columna correspondiente a 0
    await this.unreadGlobalChatRepository.update(
      { user: { id: userId } },
      { [columnToUpdate]: 0 },
    );

    return `Room ${room} has been reset to 0 for user ${userId}`;
  }

  findAllUsers() {
    return this.unreadGlobalChatRepository.find({
      relations: ['user', 'user.teacher'],
      select: {
        user: {
          id: true,
          email: true,
          language: true,
          role: true,
          teacher: {
            id: true,
          },
        },
      },
    });
  }

  async getArchivedChats(
    room: string,
    page: number,
  ): Promise<ArchivedChat[]> {
    try {
      return await this.archivedChatRepository
        .createQueryBuilder('archived_chats')
        .where('archived_chats.room = :room', { room })
        .orderBy('archived_chats.timestamp', 'DESC')
        .take(50)
        .skip((page - 1) * 50)
        .getMany();
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch archived chats');
    }
  }
  // Get last message + unread count for all teacher rooms in 2 queries
  async getTeacherRoomSummary(
    rooms: string[],
    teacherEmail: string,
  ): Promise<{ lastMessages: Record<string, any>; unreadCounts: Record<string, number> }> {
    if (!rooms.length) return { lastMessages: {}, unreadCounts: {} };

    // Query 1: latest message per room using DISTINCT ON (PostgreSQL)
    const latestRows = await this.chatRepository
      .createQueryBuilder('chat')
      .select(['chat.room', 'chat.message', 'chat.userUrl', 'chat.email', 'chat.timestamp'])
      .distinctOn(['chat.room'])
      .where('chat.room IN (:...rooms)', { rooms })
      .orderBy('chat.room')
      .addOrderBy('chat.timestamp', 'DESC')
      .getMany();

    // Query 2: unread count per room (messages not from teacher, still unread)
    const unreadRows = await this.chatRepository
      .createQueryBuilder('chat')
      .select('chat.room', 'room')
      .addSelect('COUNT(*)', 'count')
      .where('chat.room IN (:...rooms)', { rooms })
      .andWhere('chat.unread = true')
      .andWhere('chat.email != :email', { email: teacherEmail })
      .groupBy('chat.room')
      .getRawMany();

    const lastMessages: Record<string, any> = {};
    for (const row of latestRows) {
      const isFile = Boolean(row.userUrl);
      lastMessages[row.room] = {
        content: isFile ? row.userUrl : row.message,
        timestamp: row.timestamp,
        type: isFile ? 'file' : 'text',
        sender: row.email,
        isFile,
      };
    }

    const unreadCounts: Record<string, number> = {};
    for (const row of unreadRows) {
      unreadCounts[row.room] = parseInt(row.count, 10);
    }

    return { lastMessages, unreadCounts };
  }

  // Delete all chats for a specific room
  async deleteChatsByRoom(
    room: string,
  ): Promise<{ chatsDeleted: number; archivedChatsDeleted: number }> {
    try {
      const chatDeleteResult = await this.chatRepository
        .createQueryBuilder()
        .delete()
        .from(Chat)
        .where('room = :room', { room })
        .execute();

      const archivedChatDeleteResult = await this.archivedChatRepository
        .createQueryBuilder()
        .delete()
        .from(ArchivedChat)
        .where('room = :room', { room })
        .execute();

      return {
        chatsDeleted: chatDeleteResult.affected || 0,
        archivedChatsDeleted: archivedChatDeleteResult.affected || 0,
      };
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete chats');
    }
  }
}
