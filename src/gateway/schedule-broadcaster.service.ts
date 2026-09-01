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
}
