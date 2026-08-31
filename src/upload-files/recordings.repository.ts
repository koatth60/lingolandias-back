import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recording } from './entities/recording.entity';

@Injectable()
export class RecordingsRepository {
  constructor(
    @InjectRepository(Recording)
    private readonly repo: Repository<Recording>,
  ) {}

  async record(data: Partial<Recording>) {
    return this.repo.save(this.repo.create(data));
  }

  async findByTeacher(teacherId: string) {
    return this.repo.find({
      where: { teacherId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByStudent(studentId: string) {
    return this.repo.find({
      where: { studentId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteByS3Key(s3Key: string) {
    await this.repo.delete({ s3Key });
  }
}
