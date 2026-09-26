import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { DeleteUnreadDto } from './dtos/delete-unread-dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Legacy global-chat routes. Only the support channel (teachers and admins)
// still uses them. Until 2026-09-26 every route here checked login only:
// any student could read the support channel, delete any message, read any
// old DM archive, and wipe a whole room's history.
@UseGuards(AuthGuard, RolesGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('global-chats/:room')
  @Roles('teacher', 'admin')
  async getGlobalChats(@Param('room') room: string) {
    return this.chatService.getGlobalChats(room);
  }

  @Delete('delete-global-chat/:id')
  @Roles('teacher', 'admin')
  async deleteGlobalChat(@Param('id') id: string, @Req() req: any) {
    // RolesGuard has put the caller's current role on req.user.
    return this.chatService.deleteGlobalChatAs(id, {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    });
  }

  // `:id` is kept for URL compatibility, but the counters returned are always
  // the caller's own.
  @Get('unread-global-messages/:id')
  async getUnreadGlobalMessages(@CurrentUser('id') userId: string) {
    return this.chatService.getUnreadGlobalMessages(userId);
  }

  @Patch('delete-unread-global-messages')
  async deleteUnreadGlobalMessages(
    @CurrentUser('id') userId: string,
    @Body() body: DeleteUnreadDto,
  ) {
    return this.chatService.deleteUnreadGlobalMessages(userId, body.room);
  }

  // Wipes a legacy room's chats and archive. No screen calls it; kept for
  // admins only rather than open to everyone.
  @Delete('delete-chats-by-student/:studentId')
  @Roles('admin')
  async deleteChatsByStudent(@Param('studentId') studentId: string) {
    const result = await this.chatService.deleteChatsByRoom(studentId);
    return {
      message: 'Chats deleted successfully',
      ...result,
    };
  }
}
