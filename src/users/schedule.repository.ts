import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Schedule } from './entities/user.entity';

@Injectable()
export class ScheduleRepository {
  constructor(
    @InjectRepository(Schedule)
    private readonly repository: Repository<Schedule>,
  ) {}

  async findAll(): Promise<Schedule[]> {
    return this.repository.find();
  }

  async findByStudentId(studentId: string): Promise<Schedule[]> {
    return this.repository.find({ where: { studentId } });
  }

  async save(schedule: Schedule): Promise<Schedule> {
    return this.repository.save(schedule);
  }

  async modifySchedule(body: any): Promise<Schedule> {
    const { eventId, start, end, newEvent } = body;
    const schedule = await this.repository.findOne({ where: { id: eventId } });
    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }
    const newStart = new Date(start);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    schedule.startTime = newStart;
    schedule.endTime = new Date(end);
    schedule.initialDateTime = new Date(newEvent);
    schedule.dayOfWeek = dayNames[newStart.getUTCDay()];

    return await this.repository.save(schedule);
  }
  async removeEvents(body: {
    eventIds: string[];
    teacherId: string;
    studentId: string;
  }): Promise<boolean> {
    const { eventIds, teacherId, studentId } = body;
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(Schedule)
      .where('id IN (:...eventIds)', { eventIds })
      .andWhere('teacherId = :teacherId', { teacherId })
      .andWhere('studentId = :studentId', { studentId })
      .execute();

    if (result.affected === 0) {
      throw new NotFoundException('Events not found');
    }
    return true;
  }
}
