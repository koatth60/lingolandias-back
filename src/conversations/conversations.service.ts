import { Injectable } from '@nestjs/common';
import { ConversationsRepository } from './conversations.repository';

@Injectable()
export class ConversationsService {
  constructor(private readonly conversationsRepository: ConversationsRepository) {}

  findUserConversations(userId: string, opts?: { limit?: number; offset?: number }) {
    return this.conversationsRepository.findUserConversations(userId, opts);
  }

  getMembers(conversationId: string, requestingUserId?: string) {
    return this.conversationsRepository.getMembers(conversationId, requestingUserId);
  }

  findOrCreateDm(userId: string, otherUserId: string) {
    return this.conversationsRepository.findOrCreateDm(userId, otherUserId);
  }

  findExistingDm(userId: string, otherUserId: string) {
    return this.conversationsRepository.findExistingDm(userId, otherUserId);
  }

  createGroup(params: { createdBy: string; name: string; avatarUrl?: string; memberIds: string[] }) {
    return this.conversationsRepository.createGroup(params);
  }

  addMember(conversationId: string, newUserId: string, opts: { addedBy: string; shareHistory: boolean }) {
    return this.conversationsRepository.addMember(conversationId, newUserId, opts);
  }

  removeMember(conversationId: string, userId: string, requesterId: string) {
    return this.conversationsRepository.removeMember(conversationId, userId, requesterId);
  }

  renameGroup(
    conversationId: string,
    params: { name?: string; avatarUrl?: string; linkedToSchedule?: boolean },
    requesterId?: string,
  ) {
    return this.conversationsRepository.renameGroup(conversationId, params, requesterId);
  }

  getMessages(conversationId: string, opts: { before?: string; limit?: number; userId?: string }) {
    return this.conversationsRepository.getMessages(conversationId, opts);
  }

  getMessagesAsAdmin(conversationId: string, requesterId: string) {
    return this.conversationsRepository.getMessagesAsAdmin(conversationId, requesterId);
  }

  getArchivedMessages(conversationId: string, page: number) {
    return this.conversationsRepository.getArchivedMessages(conversationId, page);
  }

  markRead(conversationId: string, userId: string) {
    return this.conversationsRepository.markRead(conversationId, userId);
  }

  setPinned(conversationId: string, userId: string, pinned: boolean) {
    return this.conversationsRepository.setPinned(conversationId, userId, pinned);
  }

  setMuted(conversationId: string, userId: string, muted: boolean) {
    return this.conversationsRepository.setMuted(conversationId, userId, muted);
  }

  deleteForMe(conversationId: string, userId: string) {
    return this.conversationsRepository.deleteForMe(conversationId, userId);
  }

  deleteGroup(conversationId: string, requesterId: string) {
    return this.conversationsRepository.deleteGroup(conversationId, requesterId);
  }

  syncCoTeachers(conversationId: string) {
    return this.conversationsRepository.syncCoTeachers(conversationId);
  }
}
