import { Injectable } from '@nestjs/common';
import { ChatsRepository } from './chats.repository';
import { GlobalChat } from './entities/global-chat.entity';
import { UnreadGlobalMessage } from './entities/unread-global-messages.entity';
import { DeleteUnreadDto } from './dtos/delete-unread-dto';
import { ArchivedChat } from './entities/archived-chat.entity';

@Injectable()
export class ChatService {
  constructor(private readonly chatsRepositoy: ChatsRepository) {}

  async getGlobalChats(room: string): Promise<GlobalChat[]> {
    return this.chatsRepositoy.getGlobalChats(room);
  }

  async deleteGlobalChat(id: string): Promise<void> {
    return this.chatsRepositoy.deleteGlobalChat(id);
  }

  async getUnreadGlobalMessages(id: string): Promise<UnreadGlobalMessage[]> {
    return this.chatsRepositoy.getUnreadGlobalMessages(id);
  }

  async deleteUnreadGlobalMessages(
    userId: string,
    room: string,
  ): Promise<string> {
    return this.chatsRepositoy.deleteUnreadGlobalMessages(userId, room);
  }

  async getArchivedChats(
    room: string,
    page: number,
  ): Promise<ArchivedChat[]> {
    return this.chatsRepositoy.getArchivedChats(room, page);
  }
  async deleteChatsByRoom(
    room: string,
  ): Promise<{ chatsDeleted: number; archivedChatsDeleted: number }> {
    return this.chatsRepositoy.deleteChatsByRoom(room);
  }
}
