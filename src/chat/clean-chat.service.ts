import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Repository, LessThan } from 'typeorm'; // Import LessThan
import { InjectRepository } from '@nestjs/typeorm';
import { ArchivedChat } from './entities/archived-chat.entity';
import { Chat } from './entities/chat.entity';

@Injectable()
export class ChatCleanupService {
  constructor(
    @InjectRepository(Chat)
    private chatRepository: Repository<Chat>,

    @InjectRepository(ArchivedChat)
    private archivedChatRepository: Repository<ArchivedChat>,
  ) {}

  @Cron('0 0 * * *')
  async archiveOldMessages() {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Bulk INSERT ... SELECT directly in the database — no memory allocation for rows
    await this.chatRepository.manager.query(
      `INSERT INTO archived_chats (id, username, email, room, message, timestamp, "archivedAt")
       SELECT id, username, email, room, message, timestamp, NOW()
       FROM chats
       WHERE timestamp < $1
       ON CONFLICT (id) DO NOTHING`,
      [oneMonthAgo],
    );

    // Delete archived messages from the main chat table
    await this.chatRepository.delete({
      timestamp: LessThan(oneMonthAgo),
    });
  }

  @Cron('0 1 * * *') // Runs daily at 1:00 AM
  async deleteOldArchivedChats() {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // Delete archived chats older than one year
    await this.archivedChatRepository.delete({
      archivedAt: LessThan(oneYearAgo),
    });
  }
}
