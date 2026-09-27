import { PushService } from './push.service';

/**
 * Phase 3 (2026-09-27): sending a push to N recipients of the same group
 * message used to run one DB lookup + one webpush HTTP call PER RECIPIENT,
 * awaited one after another. sendNewMessagePushBulk/sendMentionPushBulk
 * replace that with a single subscriptions query and concurrent sends.
 */

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
const webpush = require('web-push');

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const USER_C = '33333333-3333-3333-3333-333333333333';

const makeSubscription = (userId: string) => ({
  userId, endpoint: `https://push.example/${userId}`, p256dh: 'p256dh', auth: 'auth',
});

const makeService = (subscriptions: any[]) => {
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  const subscriptionRepository = {
    find: jest.fn().mockResolvedValue(subscriptions),
    delete: jest.fn(),
  };
  const service = new PushService(subscriptionRepository as any, {} as any);
  return { service, subscriptionRepository };
};

describe('PushService — grouped sends', () => {
  afterEach(() => jest.clearAllMocks());

  it('fetches every recipient\'s subscription in a single query, not one per recipient', async () => {
    const subs = [makeSubscription(USER_A), makeSubscription(USER_B), makeSubscription(USER_C)];
    const { service, subscriptionRepository } = makeService(subs);
    webpush.sendNotification.mockResolvedValue(undefined);

    await service.sendNewMessagePushBulk([USER_A, USER_B, USER_C], { senderName: 'Ana', preview: 'hi' });

    expect(subscriptionRepository.find).toHaveBeenCalledTimes(1);
    expect(subscriptionRepository.find).toHaveBeenCalledWith({ where: { userId: expect.anything() } });
  });

  it('sends to every subscriber even if one webpush call rejects (concurrent, not chained)', async () => {
    const subs = [makeSubscription(USER_A), makeSubscription(USER_B), makeSubscription(USER_C)];
    const { service } = makeService(subs);
    webpush.sendNotification.mockImplementation(async (sub: any) => {
      if (sub.endpoint.endsWith(USER_B)) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return undefined;
    });

    await service.sendNewMessagePushBulk([USER_A, USER_B, USER_C], { senderName: 'Ana', preview: 'hi' });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
  });

  it('batch-deletes every stale (410/404) subscription in one query instead of one delete per user', async () => {
    const subs = [makeSubscription(USER_A), makeSubscription(USER_B)];
    const { service, subscriptionRepository } = makeService(subs);
    webpush.sendNotification.mockImplementation(async (sub: any) => {
      throw Object.assign(new Error('gone'), { statusCode: 410 });
    });

    await service.sendNewMessagePushBulk([USER_A, USER_B], { senderName: 'Ana', preview: 'hi' });

    expect(subscriptionRepository.delete).toHaveBeenCalledTimes(1);
    expect(subscriptionRepository.delete).toHaveBeenCalledWith({ userId: expect.anything() });
  });

  it('does not query or send at all with no recipients', async () => {
    const { service, subscriptionRepository } = makeService([]);
    await service.sendNewMessagePushBulk([], { senderName: 'Ana', preview: 'hi' });
    expect(subscriptionRepository.find).not.toHaveBeenCalled();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('sendMentionPushBulk titles the notification as a mention, independent of chatName', async () => {
    const subs = [makeSubscription(USER_A)];
    const { service } = makeService(subs);
    webpush.sendNotification.mockResolvedValue(undefined);

    await service.sendMentionPushBulk([USER_A], { senderName: 'Ana', preview: 'check this' });

    const payload = JSON.parse(webpush.sendNotification.mock.calls[0][1]);
    expect(payload.title).toBe('Ana mentioned you');
    expect(payload.body).toBe('check this');
  });
});
