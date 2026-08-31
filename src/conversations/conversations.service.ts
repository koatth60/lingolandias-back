import { Injectable } from '@nestjs/common';
import { ConversationsRepository } from './conversations.repository';

@Injectable()
export class ConversationsService {
  constructor(private readonly conversationsRepository: ConversationsRepository) {}

  findUserConversations(userId: string) {
    return this.conversationsRepository.findUserConversations(userId);
  }

  getMembers(conversationId: string) {
    return this.conversationsRepository.getMembers(conversationId);
  }

  findOrCreateDm(userId: string, otherUserId: string) {
    return this.conversationsRepository.findOrCreateDm(userId, otherUserId);
  }

  createGroup(params: { createdBy: string; name: string; avatarUrl?: string; memberIds: string[] }) {
    return this.conversationsRepository.createGroup(params);
  }

  addMember(conversationId: string, userId: string) {
    return this.conversationsRepository.addMember(conversationId, userId);
  }

  removeMember(conversationId: string, userId: string) {
    return this.conversationsRepository.removeMember(conversationId, userId);
  }

  renameGroup(conversationId: string, params: { name?: string; avatarUrl?: string; linkedToSchedule?: boolean }) {
    return this.conversationsRepository.renameGroup(conversationId, params);
  }

  getMessages(conversationId: string, opts: { before?: string; limit?: number }) {
    return this.conversationsRepository.getMessages(conversationId, opts);
  }

  getArchivedMessages(conversationId: string, page: number) {
    return this.conversationsRepository.getArchivedMessages(conversationId, page);
  }

  markRead(conversationId: string, userId: string) {
    return this.conversationsRepository.markRead(conversationId, userId);
  }
}
