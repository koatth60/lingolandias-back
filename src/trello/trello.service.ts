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
    const result = await this.boardRepo.update(id, data);
    if (result.affected === 0) throw new NotFoundException('Board not found');
    return this.boardRepo.findOne({ where: { id } });
  }

  async deleteBoard(id: string): Promise<void> {
    const result = await this.boardRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Board not found');
  }

  // ─── LISTS ───────────────────────────────────────────────────────────────

  // Single query with properly ordered cards via QueryBuilder
  async getListsByBoard(boardId: string): Promise<TrelloList[]> {
    return this.listRepo
      .createQueryBuilder('list')
      .leftJoinAndSelect('list.cards', 'card')
      .where('list.boardId = :boardId', { boardId })
      .orderBy('list.position', 'ASC')
      .addOrderBy('list.createdAt', 'ASC')
      .addOrderBy('card.position', 'ASC')
      .getMany();
  }

  async createList(boardId: string, name: string): Promise<TrelloList> {
    // Skip the board existence findOne — FK constraint will reject invalid boardId
    const count = await this.listRepo.count({ where: { boardId } });
    const list = this.listRepo.create({ name, boardId, position: count });
    const saved = await this.listRepo.save(list);
    saved.cards = [];
    return saved;
  }

  async updateList(id: string, data: Partial<{ name: string; position: number }>): Promise<TrelloList> {
    const result = await this.listRepo.update(id, data);
    if (result.affected === 0) throw new NotFoundException('List not found');
    return this.listRepo.findOne({ where: { id } });
  }

  async deleteList(id: string): Promise<void> {
    const result = await this.listRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('List not found');
  }

  // ─── CARDS ───────────────────────────────────────────────────────────────

  async createCard(
    listId: string,
    data: { name: string; description?: string; dueDate?: Date; label?: string },
  ): Promise<TrelloCard> {
    // Skip the list existence findOne — FK constraint will reject invalid listId
    const count = await this.cardRepo.count({ where: { listId } });
    const card = this.cardRepo.create({ ...data, listId, position: count });
    return this.cardRepo.save(card);
  }

  async updateCard(
    id: string,
    data: Partial<{ name: string; description: string; dueDate: Date; label: string; listId: string; position: number; checklist: string; comments: string; titleStyle: string }>,
  ): Promise<TrelloCard> {
    const result = await this.cardRepo.update(id, data);
    if (result.affected === 0) throw new NotFoundException('Card not found');
    return this.cardRepo.findOne({ where: { id } });
  }

  async deleteCard(id: string): Promise<void> {
    const result = await this.cardRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Card not found');
  }

  async moveCard(cardId: string, targetListId: string, position: number): Promise<TrelloCard> {
    const result = await this.cardRepo.update(cardId, { listId: targetListId, position });
    if (result.affected === 0) throw new NotFoundException('Card not found');
    return this.cardRepo.findOne({ where: { id: cardId } });
  }

  // Reorder lists — parallel updates instead of sequential
  async reorderLists(boardId: string, orderedIds: string[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, i) => this.listRepo.update({ id, boardId }, { position: i })),
    );
  }

  // Reorder cards — parallel updates instead of sequential
  async reorderCards(listId: string, orderedIds: string[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, i) => this.cardRepo.update({ id, listId }, { position: i })),
    );
  }
}
