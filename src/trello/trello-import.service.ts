import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrelloBoard } from './entities/trello-board.entity';
import { TrelloList } from './entities/trello-list.entity';
import { TrelloCard } from './entities/trello-card.entity';

// Trello labels come back as named colors, not hex — our own cards store hex
// so the badge <span style={{backgroundColor}}> rendering works unchanged
// for imported labels too.
const TRELLO_LABEL_COLORS: Record<string, string> = {
  green: '#61BD4F', yellow: '#F2D600', orange: '#FF9F1A', red: '#EB5A46',
  purple: '#C377E0', blue: '#0079BF', sky: '#00C2E0', lime: '#51E898',
  pink: '#FF78CB', black: '#344563', null: '#B3BAC5',
};

interface RemoteLabel { name?: string; color?: string | null }
interface RemoteCard { id: string; idList: string; name: string; desc?: string; due?: string | null; labels?: RemoteLabel[]; pos: number }
interface RemoteList { id: string; name: string; pos: number }
interface RemoteBoard { id: string; name: string; closed?: boolean; url?: string }
interface RemoteBoardDetail extends RemoteBoard { lists?: RemoteList[]; cards?: RemoteCard[] }

@Injectable()
export class TrelloImportService {
  constructor(
    @InjectRepository(TrelloBoard) private readonly boardRepo: Repository<TrelloBoard>,
    @InjectRepository(TrelloList) private readonly listRepo: Repository<TrelloList>,
    @InjectRepository(TrelloCard) private readonly cardRepo: Repository<TrelloCard>,
  ) {}

  private get apiKey(): string {
    const key = process.env.TRELLO_API_KEY;
    if (!key) {
      throw new InternalServerErrorException(
        'Trello import is not configured — TRELLO_API_KEY is missing on the server.',
      );
    }
    return key;
  }

  // Lists the real Trello boards this token can see, so the frontend can show
  // a picklist before importing anything. Read-only token from Trello's
  // client-side authorize flow — never persisted server-side.
  async listRemoteBoards(token: string): Promise<{ id: string; name: string; url: string }[]> {
    if (!token) throw new BadRequestException('Missing Trello token');
    const url = `https://api.trello.com/1/members/me/boards?key=${this.apiKey}&token=${encodeURIComponent(token)}&fields=name,closed,url`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new BadRequestException('Could not reach Trello with that token — it may have expired. Please reconnect.');
    }
    const boards = (await res.json()) as RemoteBoard[];
    return boards.filter((b) => !b.closed).map((b) => ({ id: b.id, name: b.name, url: b.url }));
  }

  // Copies one real Trello board's lists + cards (name, description, due
  // date, labels) into a brand new local TrelloBoard owned by `userId`. This
  // is a one-time migration snapshot, not an ongoing sync — the two boards
  // are independent after this call.
  async importBoard(userId: string, token: string, remoteBoardId: string): Promise<TrelloBoard> {
    if (!token || !remoteBoardId) throw new BadRequestException('Missing token or board id');

    const url =
      `https://api.trello.com/1/boards/${remoteBoardId}` +
      `?fields=name&lists=open&list_fields=name,pos&cards=open&card_fields=name,desc,due,labels,pos,idList` +
      `&key=${this.apiKey}&token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new BadRequestException('Could not fetch that board from Trello — the token may have expired.');
    }
    const remote = (await res.json()) as RemoteBoardDetail;

    const existingCount = await this.boardRepo.count({ where: { userId } });
    const board = await this.boardRepo.save(
      this.boardRepo.create({
        name: remote.name || 'Imported board',
        background: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
        fontFamily: 'Inter',
        userId,
        position: existingCount,
      }),
    );

    const remoteLists = [...(remote.lists || [])].sort((a, b) => a.pos - b.pos);
    const remoteCards = remote.cards || [];

    for (let i = 0; i < remoteLists.length; i++) {
      const remoteList = remoteLists[i];
      const list = await this.listRepo.save(
        this.listRepo.create({ name: remoteList.name, boardId: board.id, position: i }),
      );

      const cardsForList = remoteCards
        .filter((c) => c.idList === remoteList.id)
        .sort((a, b) => a.pos - b.pos);

      for (let j = 0; j < cardsForList.length; j++) {
        const remoteCard = cardsForList[j];
        const labels = (remoteCard.labels || [])
          .filter((l) => l.name || l.color)
          .map((l) => ({ name: l.name || l.color, color: TRELLO_LABEL_COLORS[l.color || 'null'] || '#B3BAC5' }));

        await this.cardRepo.save(
          this.cardRepo.create({
            name: remoteCard.name,
            description: remoteCard.desc || null,
            dueDate: remoteCard.due ? new Date(remoteCard.due) : null,
            label: labels.length ? JSON.stringify(labels) : null,
            listId: list.id,
            position: j,
          }),
        );
      }
    }

    return this.boardRepo.findOne({ where: { id: board.id } });
  }
}
