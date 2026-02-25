import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { ScheduleRepository } from './schedule.repository';
import { VideoCallsGateway } from 'src/videocalls.gateaway';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly scheduleRepository: ScheduleRepository,
    private readonly gateway: VideoCallsGateway,
  ) {}

  async findAll() {
    const users = await this.usersRepository.findAll();
    if (!users || users.length === 0) {
      throw new NotFoundException('No users found');
    }
    return users;
  }

  async assignStudent(body: any) {
    const assignedUser = await this.usersRepository.assignStudent(body);
    if (!assignedUser) {
      throw new NotFoundException('User not found');
    }
    return assignedUser;
  }

  async remove(email: string) {
    const removedUser = await this.usersRepository.remove(email);
    if (!removedUser.affected) {
      throw new NotFoundException('User not found');
    }
    return removedUser;
  }

  async update(updateUser: any) {
    const updatedUser = await this.usersRepository.update(updateUser);
    if (!updatedUser.affected) {
      throw new NotFoundException('User not found');
    }
    return updatedUser;
  }

  async removeStudentsFromTeacher(body: any) {
    const success = await this.usersRepository.removeStudentsFromTeacher(body);
    if (!success) {
      throw new NotFoundException('Schedule not found');
    }
    return success;
  }

  async modifySchedule(body: any) {
    const updatedSchedule = await this.scheduleRepository.modifySchedule(body);
    if (!updatedSchedule) {
      throw new NotFoundException('Schedule not found');
    }
    this.gateway.notifyScheduleUpdated({
      studentId: updatedSchedule.studentId,
      action: 'modify',
      schedule: updatedSchedule,
    });
    return updatedSchedule;
  }

  async removeEvents(body: {
    eventIds: string[];
    teacherId: string;
    studentId: string;
  }) {
    const success = await this.scheduleRepository.removeEvents(body);
    if (!success) {
      throw new NotFoundException('Events not found');
    }
    this.gateway.notifyScheduleUpdated({
      studentId: body.studentId,
      action: 'remove',
      eventIds: body.eventIds,
    });
    return 'success';
  }

  async getStudentSchedules(studentId: string) {
    return this.scheduleRepository.findByStudentId(studentId);
  }

  async addEvent(event: any) {
    const newEvent = {
      ...event,
      initialDateTime: new Date(event.initialDateTime),
      startTime: new Date(event.startTime),
      endTime: new Date(event.endTime),
    };
    const savedSchedule = await this.scheduleRepository.save(newEvent);
    if (!savedSchedule) {
      throw new NotFoundException('Failed to create event');
    }
    this.gateway.notifyScheduleUpdated({
      studentId: savedSchedule.studentId,
      action: 'add',
      schedule: savedSchedule,
    });
    return savedSchedule;
  }
}
