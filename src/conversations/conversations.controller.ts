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
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * Every route here takes the acting user from the JWT (@CurrentUser), never
 * from a query param or request body.
 *
 * It used to be the other way round: AuthGuard proved *that* you were logged
 * in, then each handler read `userId` straight off the request to decide *who*
 * you were. Since user ids are visible all over the UI, any logged-in user
 * could read another person's conversations, mark them read, unpin them or
 * delete them by sending that person's id. Client-supplied ids are still
 * accepted where they name the *target* of an action (which member to remove,
 * who to open a DM with) — those are authorised against the caller downstream.
 */
@UseGuards(AuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  findUserConversations(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.conversationsService.findUserConversations(userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id/messages')
  getMessages(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.getMessages(id, {
      before,
      limit: limit ? parseInt(limit, 10) : undefined,
      userId,
    });
  }

  @Get(':id/admin-messages')
  getMessagesAsAdmin(@Param('id') id: string, @CurrentUser('id') requesterId: string) {
    return this.conversationsService.getMessagesAsAdmin(id, requesterId);
  }

  @Get(':id/members')
  getMembers(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.conversationsService.getMembers(id, userId);
  }

  @Get(':id/archived-messages')
  getArchivedMessages(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
  ) {
    return this.conversationsService.getArchivedMessages(
      id,
      page ? parseInt(page, 10) : 1,
      userId,
    );
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.conversationsService.markRead(id, userId);
  }

  @Post('dm')
  findOrCreateDm(@CurrentUser('id') userId: string, @Body() body: { otherUserId: string }) {
    if (!body?.otherUserId) {
      throw new BadRequestException('otherUserId is required');
    }
    return this.conversationsService.findOrCreateDm(userId, body.otherUserId);
  }

  // Read-only lookup so the client can open an existing DM's real history
  // directly instead of always starting a fresh draft — see startDmWith in
  // messages.jsx. Always wrapped in an object (never a bare value) because
  // Nest/Express sends a bare `null` return as a zero-byte body, which
  // `res.json()` on the client throws on rather than parsing as null.
  @Get('dm/existing')
  async findExistingDm(
    @CurrentUser('id') userId: string,
    @Query('otherUserId') otherUserId: string,
  ) {
    if (!otherUserId) {
      throw new BadRequestException('otherUserId is required');
    }
    const conversation = await this.conversationsService.findExistingDm(userId, otherUserId);
    return { conversation };
  }

  // Auto-repair for legacy 1:1 classes whose "room" (the student's own
  // userId, by convention) never had a real Conversation behind it — see
  // ConversationsRepository.ensureDm. Called once when entering a private
  // call/chat, before the chat is actually used.
  @Post('dm/ensure')
  async ensureDm(
    @CurrentUser('id') userId: string,
    @Body() body: { conversationId: string; otherUserId: string },
  ) {
    if (!body?.conversationId || !body?.otherUserId) {
      throw new BadRequestException('conversationId and otherUserId are required');
    }
    return this.conversationsService.ensureDm(body.conversationId, userId, body.otherUserId);
  }

  @Post('group')
  createGroup(
    @CurrentUser('id') createdBy: string,
    @Body() body: { name: string; avatarUrl?: string; memberIds: string[] },
  ) {
    if (!body?.name || !body?.memberIds?.length) {
      throw new BadRequestException('name and memberIds are required');
    }
    return this.conversationsService.createGroup({ ...body, createdBy });
  }

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @CurrentUser('id') addedBy: string,
    @Body() body: { userId: string; shareHistory?: boolean },
  ) {
    if (!body?.userId) {
      throw new BadRequestException('userId is required');
    }
    return this.conversationsService.addMember(id, body.userId, {
      addedBy,
      shareHistory: !!body.shareHistory,
    });
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('id') requesterId: string,
  ) {
    return this.conversationsService.removeMember(id, userId, requesterId);
  }

  @Patch(':id')
  renameGroup(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { name?: string; avatarUrl?: string; linkedToSchedule?: boolean },
  ) {
    return this.conversationsService.renameGroup(id, body, userId);
  }

  @Post(':id/pin')
  setPinned(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { pinned: boolean },
  ) {
    return this.conversationsService.setPinned(id, userId, !!body?.pinned);
  }

  @Post(':id/mute')
  setMuted(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { muted: boolean },
  ) {
    return this.conversationsService.setMuted(id, userId, !!body?.muted);
  }

  @Delete(':id')
  deleteForMe(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.conversationsService.deleteForMe(id, userId);
  }

  // Hard-deletes the group for every member — distinct from deleteForMe
  // above, which only hides a conversation from the requester's own list.
  @Delete(':id/group')
  async deleteGroup(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const memberIds = await this.conversationsService.deleteGroup(id, userId);
    return { deleted: true, memberIds };
  }
}
