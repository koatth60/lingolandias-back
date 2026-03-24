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
} from '@nestjs/common';
import { TrelloService } from './trello.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('trello')
export class TrelloController {
  constructor(private readonly trelloService: TrelloService) {}

  // ─── BOARDS ──────────────────────────────────────────────────────────────

  @Get('boards')
  async getBoards(@Query('userId') userId: string) {
    const boards = await this.trelloService.getBoardsByUser(userId);
    return { success: true, boards };
  }

  @Post('boards')
  async createBoard(
    @Body('name') name: string,
    @Body('background') background: string,
    @Body('fontFamily') fontFamily: string,
    @Body('userId') userId: string,
    @Body('description') description: string,
  ) {
    const board = await this.trelloService.createBoard({
      name,
      background: background || '#0079BF',
      fontFamily: fontFamily || 'Inter',
      userId,
      description,
    });
    return { success: true, board };
  }

  @Put('boards/:id')
  async updateBoard(
    @Param('id') id: string,
    @Body() data: { name?: string; background?: string; fontFamily?: string; description?: string },
  ) {
    const board = await this.trelloService.updateBoard(id, data);
    return { success: true, board };
  }

  @Delete('boards/:id')
  @HttpCode(HttpStatus.OK)
  async deleteBoard(@Param('id') id: string) {
    await this.trelloService.deleteBoard(id);
    return { success: true };
  }

  // ─── LISTS ───────────────────────────────────────────────────────────────

  @Get('boards/:boardId/lists')
  async getLists(@Param('boardId') boardId: string) {
    const lists = await this.trelloService.getListsByBoard(boardId);
    return { success: true, lists };
  }

  @Post('boards/:boardId/lists')
  async createList(
    @Param('boardId') boardId: string,
    @Body('name') name: string,
  ) {
    const list = await this.trelloService.createList(boardId, name);
    return { success: true, list };
  }

  @Put('lists/:id')
  async updateList(
    @Param('id') id: string,
    @Body() data: { name?: string; position?: number },
  ) {
    const list = await this.trelloService.updateList(id, data);
    return { success: true, list };
  }

  @Delete('lists/:id')
  @HttpCode(HttpStatus.OK)
  async deleteList(@Param('id') id: string) {
    await this.trelloService.deleteList(id);
    return { success: true };
  }

  @Put('boards/:boardId/lists/reorder')
  async reorderLists(
    @Param('boardId') boardId: string,
    @Body('orderedIds') orderedIds: string[],
  ) {
    await this.trelloService.reorderLists(boardId, orderedIds);
    return { success: true };
  }

  // ─── CARDS ───────────────────────────────────────────────────────────────

  @Post('lists/:listId/cards')
  async createCard(
    @Param('listId') listId: string,
    @Body() data: { name: string; description?: string; dueDate?: Date; label?: string },
  ) {
    const card = await this.trelloService.createCard(listId, data);
    return { success: true, card };
  }

  @Put('cards/:id')
  async updateCard(
    @Param('id') id: string,
    @Body() data: { name?: string; description?: string; dueDate?: Date; label?: string; listId?: string; position?: number; checklist?: string; comments?: string; titleStyle?: string },
  ) {
    const card = await this.trelloService.updateCard(id, data);
    return { success: true, card };
  }

  @Delete('cards/:id')
  @HttpCode(HttpStatus.OK)
  async deleteCard(@Param('id') id: string) {
    await this.trelloService.deleteCard(id);
    return { success: true };
  }

  @Put('cards/:id/move')
  async moveCard(
    @Param('id') id: string,
    @Body('listId') listId: string,
    @Body('position') position: number,
  ) {
    const card = await this.trelloService.moveCard(id, listId, position);
    return { success: true, card };
  }

  @Put('lists/:listId/cards/reorder')
  async reorderCards(
    @Param('listId') listId: string,
    @Body('orderedIds') orderedIds: string[],
  ) {
    await this.trelloService.reorderCards(listId, orderedIds);
    return { success: true };
  }

  // ─── ADMIN ───────────────────────────────────────────────────────────────

  @Get('admin/boards')
  async getAllBoards() {
    const boards = await this.trelloService.getAllBoardsWithTeachers();
    return { success: true, boards };
  }
}
