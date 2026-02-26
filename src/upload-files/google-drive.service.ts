import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import * as fs from 'fs';

@Injectable()
export class GoogleDriveService {
  private drive;

  constructor(private readonly configService: ConfigService) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.configService.get<string>('GOOGLE_CLIENT_EMAIL'),
        // Env vars store \n as a literal string — convert back to real newlines
        private_key: this.configService
          .get<string>('GOOGLE_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    this.drive = google.drive({ version: 'v3', auth });
  }

  async uploadRecording(file: Express.Multer.File): Promise<string> {
    const folderId = this.configService.get<string>('GOOGLE_DRIVE_FOLDER_ID');

    // Stream from disk — avoids buffering the whole file in memory
    const fileStream = fs.createReadStream(file.path);

    // Upload the file into the shared folder
    const uploaded = await this.drive.files.create({
      requestBody: {
        name: file.originalname,
        mimeType: 'video/webm',
        parents: folderId ? [folderId] : [],
      },
      media: {
        mimeType: 'video/webm',
        body: fileStream,
      },
      fields: 'id, webViewLink',
    });

    // Make it readable by anyone who has the link so the teacher can share it
    await this.drive.permissions.create({
      fileId: uploaded.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    return uploaded.data.webViewLink as string;
  }
}
