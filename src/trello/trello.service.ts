import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrelloBoard } from './entities/trello-board.entity';
import { TrelloList } from './entities/trello-list.entity';
import { TrelloCard } from './entities/trello-card.entity';

@Injectable()
export class TrelloService {

  constructor(
    @InjectRepository(TrelloBoard)
    private boardRepo: Repository<TrelloBoard>,
    @InjectRepository(TrelloList)
    private listRepo: Repository<TrelloList>,
    @InjectRepository(TrelloCard)
    private cardRepo: Repository<TrelloCard>,
  ) {}

  // ─── BOARDS ──────────────────────────────────────────────────────────────

  async getBoardsByUser(userId: string): Promise<TrelloBoard[]> {
    return this.boardRepo.find({
      where: { userId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async getAllBoardsWithTeachers(): Promise<TrelloBoard[]> {
    return this.boardRepo.find({
      order: { userId: 'ASC', position: 'ASC' },
    });
  }

  async createBoard(data: {
    name: string;
    background: string;
    fontFamily: string;
    userId: string;
    description?: string;
  }): Promise<TrelloBoard> {
    const count = await this.boardRepo.count({ where: { userId: data.userId } });
    const board = this.boardRepo.create({ ...data, position: count });
    return this.boardRepo.save(board);
  }

  async updateBoard(
    id: string,
    data: Partial<{ name: string; background: string; fontFamily: string; description: string }>,
  ): Promise<TrelloBoard> {
    const board = await this.boardRepo.findOne({ where: { id } });
    if (!board) throw new NotFoundException('Board not found');
    Object.assign(board, data);
    return this.boardRepo.save(board);
  }

  async deleteBoard(id: string): Promise<void> {
    const board = await this.boardRepo.findOne({ where: { id } });
    if (!board) throw new NotFoundException('Board not found');
    await this.boardRepo.remove(board);
  }

  // ─── LISTS ───────────────────────────────────────────────────────────────

  async getListsByBoard(boardId: string): Promise<TrelloList[]> {
    return this.listRepo.find({
      where: { boardId },
      relations: ['cards'],
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async createList(boardId: string, name: string): Promise<TrelloList> {
    const board = await this.boardRepo.findOne({ where: { id: boardId } });
    if (!board) throw new NotFoundException('Board not found');
    const count = await this.listRepo.count({ where: { boardId } });
    const list = this.listRepo.create({ name, boardId, position: count });
    const saved = await this.listRepo.save(list);
    saved.cards = [];
    return saved;
  }

  async updateList(id: string, data: Partial<{ name: string; position: number }>): Promise<TrelloList> {
    const list = await this.listRepo.findOne({ where: { id } });
    if (!list) throw new NotFoundException('List not found');
    Object.assign(list, data);
    return this.listRepo.save(list);
  }

  async deleteList(id: string): Promise<void> {
    const list = await this.listRepo.findOne({ where: { id } });
    if (!list) throw new NotFoundException('List not found');
    await this.listRepo.remove(list);
  }

  // ─── CARDS ───────────────────────────────────────────────────────────────

  async createCard(
    listId: string,
    data: { name: string; description?: string; dueDate?: Date; label?: string },
  ): Promise<TrelloCard> {
    const list = await this.listRepo.findOne({ where: { id: listId } });
    if (!list) throw new NotFoundException('List not found');
    const count = await this.cardRepo.count({ where: { listId } });
    const card = this.cardRepo.create({ ...data, listId, position: count });
    return this.cardRepo.save(card);
  }

  async updateCard(
    id: string,
    data: Partial<{ name: string; description: string; dueDate: Date; label: string; listId: string; position: number; checklist: string; comments: string; titleStyle: string }>,
  ): Promise<TrelloCard> {
    const card = await this.cardRepo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Card not found');
    Object.assign(card, data);
    return this.cardRepo.save(card);
  }

  async deleteCard(id: string): Promise<void> {
    const card = await this.cardRepo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Card not found');
    await this.cardRepo.remove(card);
  }

  async moveCard(cardId: string, targetListId: string, position: number): Promise<TrelloCard> {
    const card = await this.cardRepo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card not found');
    card.listId = targetListId;
    card.position = position;
    return this.cardRepo.save(card);
  }

  // Reorder lists within a board by saving new positions array
  async reorderLists(boardId: string, orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.listRepo.update({ id: orderedIds[i], boardId }, { position: i });
    }
  }

  // Reorder cards within a list
  async reorderCards(listId: string, orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.cardRepo.update({ id: orderedIds[i], listId }, { position: i });
    }
  }
}
