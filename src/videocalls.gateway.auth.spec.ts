import { VideoCallsGateway } from './videocalls.gateaway';

/**
 * Regression tests for the authorisation holes in the chat gateway.
 *
 * Every case here was exploitable before: the gateway authenticated the
 * socket, then took the *acting user's identity* from the event payload the
 * client sent. Proving you were logged in and proving who you were had come
 * apart, so any logged-in user could act as any other.
 */

const VICTIM = '11111111-1111-1111-1111-111111111111';
const ATTACKER = '22222222-2222-2222-2222-222222222222';
const CONVERSATION = '33333333-3333-3333-3333-333333333333';
const OTHER_CONVERSATION = '44444444-4444-4444-4444-444444444444';
const MESSAGE = '55555555-5555-5555-5555-555555555555';

const makeSocket = (userId?: string, id = 'socket-1') => ({
  id,
  data: userId ? { userId, authenticated: true } : { authenticated: false },
  rooms: new Set([id]),
  join: jest.fn(function (room: string) {
    this.rooms.add(room);
  }),
  leave: jest.fn(function (room: string) {
    this.rooms.delete(room);
  }),
  emit: jest.fn(),
  broadcast: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
});

const makeGateway = (conversationsRepository: any) => {
  const gateway = new VideoCallsGateway(
    {} as any, // chatsRepository
    {} as any, // unreadCounterService
    { verify: jest.fn() } as any, // jwtService
    { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]), update: jest.fn() } as any, // userRepo
    conversationsRepository,
    { sendMentionPush: jest.fn().mockResolvedValue(undefined) } as any,
    { attach: jest.fn() } as any,
  );

  const emit = jest.fn();
  (gateway as any).server = {
    to: jest.fn().mockReturnValue({ emit }),
    emit: jest.fn(),
    sockets: { adapter: { rooms: new Map() } },
  };
  return { gateway, roomEmit: emit };
};

const baseRepo = () => ({
  isMember: jest.fn().mockResolvedValue(false),
  canJoinRoom: jest.fn().mockResolvedValue(true),
  canModifyMessage: jest.fn().mockResolvedValue(false),
  getMemberIds: jest.fn().mockResolvedValue([]),
  getMuteStatusByUserId: jest.fn().mockResolvedValue(new Map()),
  getConversationBasic: jest.fn().mockResolvedValue(null),
  saveMessage: jest.fn(async (m: any) => ({ ...m, id: MESSAGE })),
  editMessage: jest.fn(),
  deleteMessage: jest.fn(),
  markRead: jest.fn(),
});

describe('VideoCallsGateway — sender identity', () => {
  it('saves the message under the socket owner, ignoring a forged senderId', async () => {
    const repo = baseRepo();
    // The attacker IS a member here — they are allowed to post, just not to
    // post as somebody else.
    repo.isMember.mockResolvedValue(true);
    repo.getMemberIds.mockResolvedValue([ATTACKER, VICTIM]);
    const { gateway } = makeGateway(repo);

    await gateway.handleSendConversationMessage(makeSocket(ATTACKER) as any, {
      conversationId: CONVERSATION,
      senderId: VICTIM, // forged
      username: 'Victim',
      email: 'victim@example.com',
      message: 'I quit',
    } as any);

    expect(repo.saveMessage).toHaveBeenCalledTimes(1);
    expect(repo.saveMessage.mock.calls[0][0].senderId).toBe(ATTACKER);
  });

  it('checks membership against the socket owner, not the claimed sender', async () => {
    const repo = baseRepo();
    // Attacker is not a member; victim is. The old code asked about the
    // victim and let the message through.
    repo.isMember.mockImplementation(async (_c: string, u: string) => u === VICTIM);
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(ATTACKER);

    await gateway.handleSendConversationMessage(socket as any, {
      conversationId: CONVERSATION,
      senderId: VICTIM,
      username: 'Victim',
      email: 'victim@example.com',
      message: 'hello',
    } as any);

    expect(repo.saveMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('chatError', { reason: 'not_a_member' });
  });

  it('refuses an unauthenticated socket', async () => {
    const repo = baseRepo();
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(undefined);

    await gateway.handleSendConversationMessage(socket as any, {
      conversationId: CONVERSATION,
      senderId: VICTIM,
      message: 'hi',
    } as any);

    expect(repo.saveMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('chatError', { reason: 'not_authenticated' });
  });
});

describe('VideoCallsGateway — editing and deleting', () => {
  it('refuses to edit a message the caller does not own', async () => {
    const repo = baseRepo();
    repo.canModifyMessage.mockResolvedValue(false);
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(ATTACKER);

    await gateway.handleEditConversationMessage(socket as any, {
      messageId: MESSAGE,
      conversationId: CONVERSATION,
      newMessage: 'rewritten',
    });

    expect(repo.editMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('chatError', {
      reason: 'not_allowed',
      messageId: MESSAGE,
    });
  });

  it('refuses to delete a message the caller does not own', async () => {
    const repo = baseRepo();
    repo.canModifyMessage.mockResolvedValue(false);
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(ATTACKER);

    await gateway.handleDeleteConversationMessage(socket as any, {
      messageId: MESSAGE,
      conversationId: CONVERSATION,
    });

    expect(repo.deleteMessage).not.toHaveBeenCalled();
  });

  it('still lets the author edit their own message', async () => {
    const repo = baseRepo();
    repo.canModifyMessage.mockResolvedValue(true);
    const { gateway } = makeGateway(repo);

    await gateway.handleEditConversationMessage(makeSocket(VICTIM) as any, {
      messageId: MESSAGE,
      conversationId: CONVERSATION,
      newMessage: 'fixed typo',
    });

    expect(repo.editMessage).toHaveBeenCalledWith(MESSAGE, 'fixed typo', expect.any(Date));
  });

  it('still lets the author delete their own message', async () => {
    const repo = baseRepo();
    repo.canModifyMessage.mockResolvedValue(true);
    const { gateway } = makeGateway(repo);

    await gateway.handleDeleteConversationMessage(makeSocket(VICTIM) as any, {
      messageId: MESSAGE,
      conversationId: CONVERSATION,
    });

    expect(repo.deleteMessage).toHaveBeenCalledWith(MESSAGE);
  });

  it('asks about the conversation the caller named, so a message cannot be reached from another conversation', async () => {
    const repo = baseRepo();
    repo.canModifyMessage.mockResolvedValue(true);
    const { gateway } = makeGateway(repo);

    await gateway.handleDeleteConversationMessage(makeSocket(ATTACKER) as any, {
      messageId: MESSAGE,
      conversationId: OTHER_CONVERSATION,
    });

    expect(repo.canModifyMessage).toHaveBeenCalledWith(MESSAGE, OTHER_CONVERSATION, ATTACKER);
  });
});

describe('VideoCallsGateway — registerUser', () => {
  it('registers the token owner, not the id the client claims', async () => {
    const repo = baseRepo();
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(ATTACKER);

    await gateway.handleRegisterUser(socket as any, { userId: VICTIM });

    expect((gateway as any).socketToUser.get(socket.id)).toBe(ATTACKER);
    expect((gateway as any).userSockets.has(VICTIM)).toBe(false);
  });

  it('refuses a socket with no verified token', async () => {
    const repo = baseRepo();
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(undefined);
    (gateway as any).verifySocketToken = jest.fn().mockReturnValue(false);

    await gateway.handleRegisterUser(socket as any, { userId: VICTIM });

    expect((gateway as any).socketToUser.size).toBe(0);
    expect(socket.emit).toHaveBeenCalledWith('chatError', { reason: 'not_authenticated' });
  });
});

describe('VideoCallsGateway — markConversationRead', () => {
  it('marks the socket owner read, not the id supplied by the client', async () => {
    const repo = baseRepo();
    repo.isMember.mockResolvedValue(true);
    const { gateway } = makeGateway(repo);

    await gateway.handleMarkConversationRead(makeSocket(ATTACKER) as any, {
      conversationId: CONVERSATION,
      userId: VICTIM,
    });

    expect(repo.markRead).toHaveBeenCalledWith(CONVERSATION, ATTACKER);
  });
});

describe('VideoCallsGateway — room membership', () => {
  it('does not evict the socket from rooms it already joined', async () => {
    const repo = baseRepo();
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(VICTIM);
    socket.rooms.add(OTHER_CONVERSATION);

    await gateway.handleJoinRoom(socket as any, {
      username: 'Victim',
      room: CONVERSATION,
    });

    // The old implementation left every room before joining, which silently
    // killed live delivery for whichever chat view had joined first.
    expect(socket.leave).not.toHaveBeenCalled();
    expect(socket.rooms.has(OTHER_CONVERSATION)).toBe(true);
    expect(socket.rooms.has(CONVERSATION)).toBe(true);
  });

  it('rejects joining a conversation the caller is not a member of', async () => {
    const repo = baseRepo();
    repo.canJoinRoom.mockResolvedValue(false);
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(ATTACKER);

    await gateway.handleJoinRoom(socket as any, {
      username: 'Attacker',
      room: CONVERSATION,
    });

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('chatError', { reason: 'not_a_member' });
  });

  it('leaves only the named room on an explicit leave', () => {
    const repo = baseRepo();
    const { gateway } = makeGateway(repo);
    const socket = makeSocket(VICTIM);
    socket.rooms.add(CONVERSATION);
    socket.rooms.add(OTHER_CONVERSATION);

    gateway.handleLeaveRoom(socket as any, { room: CONVERSATION });

    expect(socket.rooms.has(CONVERSATION)).toBe(false);
    expect(socket.rooms.has(OTHER_CONVERSATION)).toBe(true);
  });
});
