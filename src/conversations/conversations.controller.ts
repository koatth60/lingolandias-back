import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  findUserConversations(
    @Query('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!userId) throw new BadRequestException('userId is required');
    return this.conversationsService.findUserConversations(userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id/messages')
  getMessages(
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
  ) {
    return this.conversationsService.getMessages(id, {
      before,
      limit: limit ? parseInt(limit, 10) : undefined,
      userId,
    });
  }

  @Get(':id/members')
  getMembers(@Param('id') id: string) {
    return this.conversationsService.getMembers(id);
  }

  @Get(':id/archived-messages')
  getArchivedMessages(@Param('id') id: string, @Query('page') page?: string) {
    return this.conversationsService.getArchivedMessages(id, page ? parseInt(page, 10) : 1);
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @Body('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId is required');
    return this.conversationsService.markRead(id, userId);
  }

  @Post('dm')
  findOrCreateDm(@Body() body: { userId: string; otherUserId: string }) {
    if (!body?.userId || !body?.otherUserId) {
      throw new BadRequestException('userId and otherUserId are required');
    }
    return this.conversationsService.findOrCreateDm(body.userId, body.otherUserId);
  }

  @Post('group')
  createGroup(
    @Body() body: { createdBy: string; name: string; avatarUrl?: string; memberIds: string[] },
  ) {
    if (!body?.createdBy || !body?.name || !body?.memberIds?.length) {
      throw new BadRequestException('createdBy, name and memberIds are required');
    }
    return this.conversationsService.createGroup(body);
  }

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @Body() body: { userId: string; addedBy: string; shareHistory?: boolean },
  ) {
    if (!body?.userId || !body?.addedBy) {
      throw new BadRequestException('userId and addedBy are required');
    }
    return this.conversationsService.addMember(id, body.userId, {
      addedBy: body.addedBy,
      shareHistory: !!body.shareHistory,
    });
  }

  @Delete(':id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.conversationsService.removeMember(id, userId);
  }

  @Patch(':id')
  renameGroup(
    @Param('id') id: string,
    @Body() body: { name?: string; avatarUrl?: string; linkedToSchedule?: boolean },
  ) {
    return this.conversationsService.renameGroup(id, body);
  }

  @Post(':id/pin')
  setPinned(@Param('id') id: string, @Body() body: { userId: string; pinned: boolean }) {
    if (!body?.userId) throw new BadRequestException('userId is required');
    return this.conversationsService.setPinned(id, body.userId, !!body.pinned);
  }

  @Post(':id/mute')
  setMuted(@Param('id') id: string, @Body() body: { userId: string; muted: boolean }) {
    if (!body?.userId) throw new BadRequestException('userId is required');
    return this.conversationsService.setMuted(id, body.userId, !!body.muted);
  }

  @Delete(':id')
  deleteForMe(@Param('id') id: string, @Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId is required');
    return this.conversationsService.deleteForMe(id, userId);
  }
}
