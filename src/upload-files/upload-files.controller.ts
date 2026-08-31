import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UploadedFile,
  Body,
  UseInterceptors,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as fs from 'fs';
import { S3Service } from './upload-files.service';
import { UsersRepository } from 'src/users/users.repository';
import { MeetingLogsService } from 'src/meeting-logs/meeting-logs.service';
import { RecordingsRepository } from './recordings.repository';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly s3Service: S3Service,
    private readonly usersRepository: UsersRepository,
    private readonly meetingLogsService: MeetingLogsService,
    private readonly recordingsRepository: RecordingsRepository,
  ) {}

  @Post('file')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }

    try {
      const uploadResult = await this.s3Service.uploadFile(file);
      const updatedUser = await this.usersRepository.updateUserProfileImage(
        userId,
        uploadResult.url,
      );
      return {
        message: 'File uploaded successfully and user profile updated',
        user: updatedUser,
      };
    } catch (error) {
      throw new HttpException(
        'Error uploading file and updating user profile',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('chat-upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadChatFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'audio/mpeg',
      'audio/wav',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'video/mp4',
      'audio/mp3',
      'video/x-msvideo',
      'video/quicktime',
      'application/zip',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new HttpException(
        'File type not supported',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const uploadResult = await this.s3Service.uploadChatFile(file);
      return {
        message: 'File uploaded successfully',
        fileUrl: uploadResult.url,
      };
    } catch (error) {
      throw new HttpException(
        'Error uploading file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── Recordings (S3) ────────────────────────────────────────────────────

  @Post('recording')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, _file, cb) =>
          cb(null, `lingo-rec-${Date.now()}.webm`),
      }),
    }),
  )
  async uploadRecording(
    @UploadedFile() file: Express.Multer.File,
    @Body('teacherName') teacherName: string,
    @Body('teacherEmail') teacherEmail: string,
    @Body('role') role: string,
  ) {
    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.s3Service.uploadRecording(
        file,
        teacherName,
        teacherEmail,
        role,
      );
      try {
        fs.unlinkSync(file.path);
      } catch { /* temp file already gone */ }
      return { url: result.url, key: result.key };
    } catch (error) {
      console.error('Recording upload error:', error);
      try {
        if (file?.path) fs.unlinkSync(file.path);
      } catch { /* ignore */ }
      throw new HttpException(
        'Error uploading recording',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Called by the Jibri finalize-recording script (server-side, no user session) once
  // a conference recording is done. `roomId` is the Jitsi room name — for 1:1 classes
  // that's the student's user id, so we can look up their teacher for the S3 folder;
  // for anything else (group/language rooms, unknown ids) it falls back to "others".
  @Post('recording-jibri')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, _file, cb) =>
          cb(null, `lingo-jibri-${Date.now()}.mp4`),
      }),
    }),
  )
  async uploadJibriRecording(
    @UploadedFile() file: Express.Multer.File,
    @Body('roomId') roomId: string,
  ) {
    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }

    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId || '');
    const student = isUuid ? await this.usersRepository.findById(roomId) : null;

    let teacherName = '';
    let teacherEmail = '';
    let role = 'admin'; // S3Service.uploadRecording files "admin" role under recordings/others/
    let filename: string;
    const is1on1 = Boolean(student?.teacher);

    if (student?.teacher) {
      const teacherFirst = student.teacher.name || 'Teacher';
      const studentFirst = student.name || 'Student';
      teacherName = `${student.teacher.name} ${student.teacher.lastName}`;
      teacherEmail = student.teacher.email;
      role = 'teacher';
      filename = `${teacherFirst}_${studentFirst}_${date}.mp4`;
    } else {
      // Not a 1:1 class (group/language room, or an unrecognized id) — credit
      // whoever actually clicked "record" (logged client-side when recording
      // started) so the file is still easy to find instead of landing in an
      // anonymous "others" pile with no name attached.
      const recorder = await this.meetingLogsService.findLastRecorder(roomId);
      if (recorder?.email) {
        const recorderFirst = (recorder.userName || 'Meeting').split(' ')[0];
        teacherName = recorder.userName || '';
        teacherEmail = recorder.email;
        role = 'teacher'; // routes into the recorder's own S3 folder instead of "others"
        filename = `${recorderFirst}_Meeting_${date}.mp4`;
      } else {
        filename = `Room_${roomId || 'unknown'}_${date}.mp4`;
      }
    }
    file.originalname = filename;

    try {
      const result = await this.s3Service.uploadRecording(file, teacherName, teacherEmail, role);
      try {
        fs.unlinkSync(file.path);
      } catch { /* temp file already gone */ }

      // Only 1:1 classes get a DB row — that's what powers the teacher/student
      // "my recordings" views. Group/unrecognized-room recordings stay S3-only,
      // same as before, visible only via the admin dashboard's S3 listing.
      if (is1on1) {
        await this.recordingsRepository.record({
          teacherId: student.teacher.id,
          teacherName,
          teacherEmail,
          studentId: student.id,
          studentName: student.name,
          roomId,
          s3Key: result.key,
          filename,
          sizeBytes: file.size,
        });
      }

      return { url: result.url, key: result.key };
    } catch (error) {
      console.error('Jibri recording upload error:', error);
      try {
        if (file?.path) fs.unlinkSync(file.path);
      } catch { /* ignore */ }
      throw new HttpException(
        'Error uploading recording',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── "My recordings" — teacher/student self-service views ────────────────

  @Get('recordings/teacher/:teacherId')
  async listTeacherRecordings(@Param('teacherId') teacherId: string) {
    const recordings = await this.recordingsRepository.findByTeacher(teacherId);
    const grouped: Record<string, { displayName: string; recordings: any[] }> = {};
    for (const r of recordings) {
      const key = r.studentId || 'unknown';
      if (!grouped[key]) {
        grouped[key] = { displayName: r.studentName || 'Unknown', recordings: [] };
      }
      grouped[key].recordings.push({
        key: r.s3Key,
        filename: r.filename,
        size: Number(r.sizeBytes) || 0,
        lastModified: r.createdAt,
        url: this.s3Service.buildUrl(r.s3Key),
      });
    }
    return grouped;
  }

  @Get('recordings/student/:studentId')
  async listStudentRecordings(@Param('studentId') studentId: string) {
    const recordings = await this.recordingsRepository.findByStudent(studentId);
    return recordings.map((r) => ({
      key: r.s3Key,
      filename: r.filename,
      size: Number(r.sizeBytes) || 0,
      lastModified: r.createdAt,
      teacherName: r.teacherName,
      url: this.s3Service.buildUrl(r.s3Key),
    }));
  }

  @Get('recordings')
  async listRecordings() {
    try {
      return await this.s3Service.listRecordings();
    } catch (error) {
      console.error('List recordings error:', error);
      throw new HttpException(
        'Error listing recordings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('recording')
  async deleteRecording(@Body('key') key: string) {
    if (!key) {
      throw new HttpException('No key provided', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.s3Service.deleteRecording(key);
      await this.recordingsRepository.deleteByS3Key(key);
      return result;
    } catch (error) {
      console.error('Delete recording error:', error);
      throw new HttpException(
        'Error deleting recording',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
