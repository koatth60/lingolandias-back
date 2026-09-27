import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TrelloService } from './trello.service';
import { TrelloImportService } from './trello-import.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Every board/list/card mutation below used to take only an id, with no
// check that the caller owned the board it belonged to — any logged-in
// teacher could read, edit or delete any other teacher's Trello board, list
// or card just by knowing (or guessing) its uuid. assertOwnsBoard/List/Card
// close that: the caller must own the board, or be an admin.
@UseGuards(AuthGuard)
@Controller('trello')
export class TrelloController {
  constructor(
    private readonly trelloService: TrelloService,
    private readonly trelloImportService: TrelloImportService,
  ) {}

  private async isAdmin(userId: string): Promise<boolean> {
    return (await this.trelloService.getUserRole(userId)) === 'admin';
  }

  private async assertOwnsBoard(boardId: string, callerId: string) {
    const ownerId = await this.trelloService.getBoardOwnerId(boardId);
    if (!ownerId) throw new NotFoundException('Board not found');
    if (ownerId === callerId) return;
    if (await this.isAdmin(callerId)) return;
    throw new ForbiddenException('Not your board');
  }

  private async assertOwnsList(listId: string, callerId: string) {
    const ownerId = await this.trelloService.getListOwnerId(listId);
    if (!ownerId) throw new NotFoundException('List not found');
    if (ownerId === callerId) return;
    if (await this.isAdmin(callerId)) return;
    throw new ForbiddenException('Not your list');
  }

  private async assertOwnsCard(cardId: string, callerId: string) {
    const ownerId = await this.trelloService.getCardOwnerId(cardId);
    if (!ownerId) throw new NotFoundException('Card not found');
    if (ownerId === callerId) return;
    if (await this.isAdmin(callerId)) return;
    throw new ForbiddenException('Not your card');
  }

  // ─── BOARDS ──────────────────────────────────────────────────────────────

  // `userId` names whose boards to list — restricted to the caller's own,
  // unless the caller is an admin. Previously any logged-in user could pass
  // any other userId here and get their full board list back.
  @Get('boards')
  async getBoards(@Query('userId') userId: string, @CurrentUser('id') callerId: string) {
    if (userId !== callerId && !(await this.isAdmin(callerId))) {
      throw new ForbiddenException("Not your boards");
    }
    const boards = await this.trelloService.getBoardsByUser(userId);
    return { success: true, boards };
  }

  @Post('boards')
  async createBoard(
    @Body('name') name: string,
    @Body('background') background: string,
    @Body('fontFamily') fontFamily: string,
    @Body('description') description: string,
    @CurrentUser('id') callerId: string,
  ) {
    // The board is always created for the caller — a body-supplied userId
    // used to let anyone create a board "owned" by someone else.
    const board = await this.trelloService.createBoard({
      name,
      background: background || '#0079BF',
      fontFamily: fontFamily || 'Inter',
      userId: callerId,
      description,
    });
    return { success: true, board };
  }

  @Put('boards/:id')
  async updateBoard(
    @Param('id') id: string,
    @Body() data: { name?: string; background?: string; fontFamily?: string; description?: string },
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnsBoard(id, callerId);
    const board = await this.trelloService.updateBoard(id, data);
    return { success: true, board };
  }

  @Delete('boards/:id')
  @HttpCode(HttpStatus.OK)
  async deleteBoard(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    await this.assertOwnsBoard(id, callerId);
    await this.trelloService.deleteBoard(id);
    return { success: true };
  }

  // ─── LISTS ───────────────────────────────────────────────────────────────

  @Get('boards/:boardId/lists')
  async getLists(@Param('boardId') boardId: string, @CurrentUser('id') callerId: string) {
    await this.assertOwnsBoard(boardId, callerId);
    const lists = await this.trelloService.getListsByBoard(boardId);
    return { success: true, lists };
  }

  @Post('boards/:boardId/lists')
  async createList(
    @Param('boardId') boardId: string,
    @Body('name') name: string,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnsBoard(boardId, callerId);
    const list = await this.trelloService.createList(boardId, name);
    return { success: true, list };
  }

  @Put('lists/:id')
  async updateList(
    @Param('id') id: string,
    @Body() data: { name?: string; position?: number },
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnsList(id, callerId);
    const list = await this.trelloService.updateList(id, data);
    return { success: true, list };
  }

  @Delete('lists/:id')
  @HttpCode(HttpStatus.OK)
  async deleteList(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    await this.assertOwnsList(id, callerId);
    await this.trelloService.deleteList(id);
    return { success: true };
  }

  @Put('boards/:boardId/lists/reorder')
  async reorderLists(
    @Param('boardId') boardId: string,
    @Body('orderedIds') orderedIds: string[],
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnsBoard(boardId, callerId);
    await this.trelloService.reorderLists(boardId, orderedIds);
    return { success: true };
  }

  // ─── CARDS ───────────────────────────────────────────────────────────────

  @Post('lists/:listId/cards')
  async createCard(
    @Param('listId') listId: string,
    @Body() data: { name: string; description?: string; dueDate?: Date; label?: string },
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnsList(listId, callerId);
    const card = await this.trelloService.createCard(listId, data);
    return { success: true, card };
  }

  @Put('cards/:id')
  async updateCard(
    @Param('id') id: string,
    @Body() data: { name?: string; description?: string; dueDate?: Date; label?: string; listId?: string; position?: number; checklist?: string; comments?: string; titleStyle?: string },
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnsCard(id, callerId);
    // Moving the card to a different list by editing listId here (instead of
    // through /move below) must land inside a board the caller also owns.
    if (data.listId) await this.assertOwnsList(data.listId, callerId);
    const card = await this.trelloService.updateCard(id, data);
    return { success: true, card };
  }

  @Delete('cards/:id')
  @HttpCode(HttpStatus.OK)
  async deleteCard(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    await this.assertOwnsCard(id, callerId);
    await this.trelloService.deleteCard(id);
    return { success: true };
  }

  @Put('cards/:id/move')
  async moveCard(
    @Param('id') id: string,
    @Body('listId') listId: string,
    @Body('position') position: number,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnsCard(id, callerId);
    await this.assertOwnsList(listId, callerId);
    const card = await this.trelloService.moveCard(id, listId, position);
    return { success: true, card };
  }

  @Put('lists/:listId/cards/reorder')
  async reorderCards(
    @Param('listId') listId: string,
    @Body('orderedIds') orderedIds: string[],
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnsList(listId, callerId);
    await this.trelloService.reorderCards(listId, orderedIds);
    return { success: true };
  }

  // ─── IMPORT FROM REAL TRELLO ────────────────────────────────────────────
  // Migration tool, not a live sync — the token is only ever passed through
  // per-request, never stored server-side.

  @Get('import/remote-boards')
  async getRemoteBoards(@Query('token') token: string) {
    const boards = await this.trelloImportService.listRemoteBoards(token);
    return { success: true, boards };
  }

  @Post('import/board')
  async importBoard(
    @Body() body: { token: string; remoteBoardId: string },
    @CurrentUser('id') callerId: string,
  ) {
    // Imports into the caller's own account — a body-supplied userId used to
    // let anyone import a board "owned" by someone else.
    const board = await this.trelloImportService.importBoard(callerId, body.token, body.remoteBoardId);
    return { success: true, board };
  }

  // ─── ADMIN ───────────────────────────────────────────────────────────────

  @Get('admin/boards')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getAllBoards() {
    const boards = await this.trelloService.getAllBoardsWithTeachers();
    return { success: true, boards };
  }
}
