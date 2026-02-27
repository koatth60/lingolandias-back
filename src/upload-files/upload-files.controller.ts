import {
  Controller,
  Post,
  Get,
  Delete,
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

@Controller('upload')
export class UploadController {
  constructor(
    private readonly s3Service: S3Service,
    private readonly usersRepository: UsersRepository,
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
      limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB max
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
      return await this.s3Service.deleteRecording(key);
    } catch (error) {
      console.error('Delete recording error:', error);
      throw new HttpException(
        'Error deleting recording',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
