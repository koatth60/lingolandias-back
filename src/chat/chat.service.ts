import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  // Authors may delete their own message; admins may delete any. Same rule
  // as the gateway's deleteSupportChat handler.
  async deleteGlobalChatAs(
    id: string,
    actor: { id: string; email: string; role: string },
  ): Promise<void> {
    const message = await this.chatsRepositoy.findGlobalChatById(id);
    if (!message) throw new NotFoundException('Message not found');
    const isAuthor = message.senderId
      ? message.senderId === actor.id
      : !!message.email && message.email === actor.email;
    if (actor.role !== 'admin' && !isAuthor) {
      throw new ForbiddenException('You can only delete your own messages');
    }
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
