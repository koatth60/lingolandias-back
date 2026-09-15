import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { DeleteUnreadDto } from './dtos/delete-unread-dto';
import { GetArchivedChatsDto } from './dtos/get-archived-chats.dto';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('global-chats/:room')
  async getGlobalChats(@Param('room') room: string) {
    return this.chatService.getGlobalChats(room);
  }

  @Delete('delete-global-chat/:id')
  async deleteGlobalChat(@Param('id') id: string) {
    return this.chatService.deleteGlobalChat(id);
  }

  @Get('unread-global-messages/:id')
  async getUnreadGlobalMessages(@Param('id') id: string) {
    return this.chatService.getUnreadGlobalMessages(id);
  }

  @Patch('delete-unread-global-messages')
  async deleteUnreadGlobalMessages(@Body() body: DeleteUnreadDto) {
    const { room, userId } = body;
    return this.chatService.deleteUnreadGlobalMessages(userId, room);
  }

  @Get('archived-messages/:room')
  async getArchivedChats(
    @Param('room') room: string,
    @Query() query: GetArchivedChatsDto,
  ) {
    return this.chatService.getArchivedChats(room, query.page);
  }
  @Delete('delete-chats-by-student/:studentId')
  async deleteChatsByStudent(@Param('studentId') studentId: string) {
    const result = await this.chatService.deleteChatsByRoom(studentId);
    return {
      message: 'Chats deleted successfully',
      ...result,
    };
  }
}
