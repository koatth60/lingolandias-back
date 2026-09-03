import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

// A minimal, dependency-free leaf service that both VideoCallsGateway (which
// owns the actual socket.io Server instance) and ConversationsRepository
// (which needs to push live schedule updates whenever a class tied to a
// group chat changes — renamed, a member added/removed) can depend on
// without creating a module import cycle between GatewayModule and
// ConversationsModule. VideoCallsGateway attaches the real server once it's
// bound (see its afterInit hook); every call before that is a harmless no-op.
@Injectable()
export class ScheduleBroadcaster {
  private server?: Server;

  attach(server: Server) {
    this.server = server;
  }

  notifyScheduleUpdated(payload: {
    studentId: string;
    teacherId?: string;
    action: 'add' | 'remove' | 'modify';
    schedule?: any;
    eventIds?: string[];
  }) {
    this.server?.emit('scheduleUpdated', payload);
  }

  // Pushes a saved Message row (system-event or otherwise) to everyone
  // currently viewing that conversation, via the same 'conversationMessage'
  // event VideoCallsGateway emits for a normal chat message — so the
  // existing frontend socket listener picks it up with no changes needed.
  notifyConversationMessage(message: { conversationId: string }) {
    this.server?.to(message.conversationId).emit('conversationMessage', message);
  }

  // Pushes a live name/type/avatar change for a conversation to everyone
  // currently viewing it — e.g. a group's auto-computed name shifting after
  // someone is added/removed, a group collapsing back into a plain 1:1 DM,
  // or a deliberate rename. Without this, only the person who triggered the
  // change sees it update (their own optimistic client-side state); anyone
  // else with the chat open needs a manual reload to notice.
  notifyConversationUpdated(payload: {
    conversationId: string;
    name?: string | null;
    type?: string;
    avatarUrl?: string | null;
    linkedToSchedule?: boolean;
  }) {
    this.server?.to(payload.conversationId).emit('conversationUpdated', payload);
  }
}
