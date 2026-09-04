import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, In, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { TrelloCard } from './entities/trello-card.entity';
import { TrelloList } from './entities/trello-list.entity';
import { TrelloBoard } from './entities/trello-board.entity';
import { User } from '../users/entities/user.entity';
import { PushService } from '../push/push.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class TrelloReminderService {
  private readonly logger = new Logger(TrelloReminderService.name);

  constructor(
    @InjectRepository(TrelloCard)
    private readonly cardRepo: Repository<TrelloCard>,
    @InjectRepository(TrelloList)
    private readonly listRepo: Repository<TrelloList>,
    @InjectRepository(TrelloBoard)
    private readonly boardRepo: Repository<TrelloBoard>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly pushService: PushService,
    private readonly mailService: MailService,
  ) {}

  // Due dates on a card are date-only (no time-of-day), so unlike class
  // reminders there's no single "N minutes before" instant to match — instead
  // this fires once per card, the first time it's found inside the 24h
  // window before (or already past) its due date, gated by `reminderSent` so
  // it never repeats. Runs every 15 min rather than every minute since a
  // day-granularity deadline doesn't need minute precision.
  @Cron('0 */15 * * * *')
  async sendDueReminders() {
    const windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // dueDate IS NULL naturally fails the "<= windowEnd" comparison in SQL,
    // so cards without a due date are excluded without an extra IS NOT NULL check.
    const dueCards = await this.cardRepo.find({
      where: { dueDate: LessThanOrEqual(windowEnd), reminderSent: false },
    });
    if (!dueCards.length) return;

    const listIds = [...new Set(dueCards.map((c) => c.listId))];
    const lists = await this.listRepo.findBy({ id: In(listIds) });
    const listById = new Map(lists.map((l) => [l.id, l]));

    const boardIds = [...new Set(lists.map((l) => l.boardId))];
    const boards = await this.boardRepo.findBy({ id: In(boardIds) });
    const boardById = new Map(boards.map((b) => [b.id, b]));

    const ownerIds = [...new Set(boards.map((b) => b.userId))];
    const owners = ownerIds.length
      ? await this.userRepo.find({ where: { id: In(ownerIds) }, relations: ['settings'] })
      : [];
    const ownerById = new Map(owners.map((u) => [u.id, u]));

    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

    for (const card of dueCards) {
      const list = listById.get(card.listId);
      const board = list ? boardById.get(list.boardId) : undefined;
      const owner = board ? ownerById.get(board.userId) : undefined;

      // Always mark as sent even if we end up skipping (no board/owner, or
      // the owner opted out) — otherwise a card with no resolvable owner
      // would be re-queried every 15 minutes forever.
      await this.cardRepo.update(card.id, { reminderSent: true });

      if (!board || !owner || !owner.settings?.cardDueReminders) continue;

      try {
        await this.pushService.sendCardDueReminder(owner.id, {
          cardName: card.name,
          boardName: board.name,
        });
      } catch (err) {
        this.logger.error(`Failed to push due reminder for card ${card.id}`, err);
      }

      try {
        await this.mailService.sendCardDueReminderEmail({
          name: owner.name,
          email: owner.email,
          cardName: card.name,
          boardName: board.name,
          listName: list.name,
          dueDate: new Date(card.dueDate).toLocaleDateString(),
          boardUrl: `${frontendUrl}/trello`,
        });
      } catch (err) {
        this.logger.error(`Failed to email due reminder for card ${card.id}`, err);
      }

      this.logger.log(`Due reminder sent for card "${card.name}" to ${owner.email}`);
    }
  }
}
