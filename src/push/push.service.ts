import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as webpush from 'web-push';
import { PushSubscription } from './push-subscription.entity';
import { Schedule } from '../users/entities/user.entity';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptionRepository: Repository<PushSubscription>,
    @InjectRepository(Schedule)
    private readonly scheduleRepository: Repository<Schedule>,
  ) {
    webpush.setVapidDetails(
      'mailto:agata@lingolandias.net',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
  }

  getVapidPublicKey() {
    return { publicKey: process.env.VAPID_PUBLIC_KEY };
  }

  async saveSubscription(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    await this.subscriptionRepository.delete({ userId });
    const sub = this.subscriptionRepository.create({
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    });
    return this.subscriptionRepository.save(sub);
  }

  async removeSubscription(userId: string) {
    await this.subscriptionRepository.delete({ userId });
  }

  // Reaches someone even with the tab/browser fully closed, unlike the
  // in-app IncomingCallBanner (socket-only). The deep link is query-params
  // rather than router state, since a service worker's notificationclick
  // can only open a URL — JitsiClassRoom.jsx falls back to reading these
  // when location.state is empty (e.g. after a fresh tab opened this way).
  async sendCallNotification(
    userId: string,
    params: { callerName: string; chatName?: string; chatType: string; conversationId: string; callerId: string },
  ) {
    const title = params.chatType === 'group' && params.chatName
      ? `${params.callerName} is calling in ${params.chatName}`
      : `Incoming call from ${params.callerName}`;
    const url = `/classroom?conversationId=${encodeURIComponent(params.conversationId)}&chatType=${encodeURIComponent(params.chatType)}&callerId=${encodeURIComponent(params.callerId)}&callerName=${encodeURIComponent(params.callerName)}${params.chatName ? `&chatName=${encodeURIComponent(params.chatName)}` : ''}`;
    await this.sendPush(userId, title, 'Tap to join', url);
  }

  private async sendPush(userId: string, title: string, body: string, url = '/') {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId },
    });
    if (!subscription) return;

    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };

    try {
      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify({ title, body, icon: '/logo.png', url }),
      );
    } catch (err) {
      this.logger.error(
        `Push failed for user ${userId}: status=${err.statusCode} body=${JSON.stringify(err.body)}`,
      );
      // 410 = subscription expired/unsubscribed; 404 = endpoint gone
      if (err.statusCode === 410 || err.statusCode === 404) {
        await this.subscriptionRepository.delete({ userId });
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sendClassReminders() {
    const now = new Date();
    // Target time = 10 minutes from now
    const target = new Date(now.getTime() + 10 * 60 * 1000);

    const dayNames = [
      'Sunday', 'Monday', 'Tuesday', 'Wednesday',
      'Thursday', 'Friday', 'Saturday',
    ];
    const dayOfWeek = dayNames[target.getUTCDay()];
    const targetHour = target.getUTCHours();
    const targetMinute = target.getUTCMinutes();

    // Match by day-of-week + time-of-day so recurring weekly classes are found
    // every week, not just on the original first-occurrence date.
    const upcomingSchedules = await this.scheduleRepository
      .createQueryBuilder('schedule')
      .leftJoinAndSelect('schedule.student', 'student')
      .leftJoinAndSelect('student.settings', 'studentSettings')
      .leftJoinAndSelect('schedule.teacher', 'teacher')
      .leftJoinAndSelect('teacher.settings', 'teacherSettings')
      .where('schedule.dayOfWeek = :dayOfWeek', { dayOfWeek })
      .andWhere('EXTRACT(HOUR FROM schedule."startTime") = :hour', { hour: targetHour })
      .andWhere('EXTRACT(MINUTE FROM schedule."startTime") = :minute', { minute: targetMinute })
      .getMany();

    // The query above only matches day-of-week + time-of-day, so it fires every
    // week regardless of recurrence — filter out schedules whose interval (e.g.
    // every-2-weeks) means this particular week is actually an "off" week.
    const dueSchedules = upcomingSchedules.filter((schedule) => {
      const interval = schedule.recurrenceWeeks || 1;
      if (interval <= 1) return true;
      const weeksSinceStart = Math.round(
        (target.getTime() - new Date(schedule.initialDateTime).getTime()) / (7 * 24 * 60 * 60 * 1000),
      );
      return weeksSinceStart >= 0 && weeksSinceStart % interval === 0;
    });

    for (const schedule of dueSchedules) {
      // Notify student
      if (schedule.student?.settings?.classReminders) {
        await this.sendPush(
          schedule.student.id,
          'Class starting in 10 minutes!',
          `Your class with ${schedule.teacherName} is about to start. Get ready!`,
        );
        this.logger.log(`Reminder sent to student ${schedule.studentName}`);
      }

      // Notify teacher
      if (schedule.teacher?.settings?.classReminders) {
        await this.sendPush(
          schedule.teacher.id,
          'Class starting in 10 minutes!',
          `Your class with ${schedule.studentName} is about to start. Get ready!`,
        );
        this.logger.log(`Reminder sent to teacher ${schedule.teacherName}`);
      }
    }
  }
}
