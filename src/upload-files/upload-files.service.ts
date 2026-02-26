import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';

@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  async uploadFile(file: Express.Multer.File) {
    const bucketName = this.configService.get('AWS_BUCKET_NAME');
    const region = this.configService.get('AWS_REGION');
    const folderPrefix = 'avatar-images/';
    const fileKey = `${folderPrefix}${file.originalname}`;

    const uploadParams = {
      Bucket: bucketName,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    try {
      await this.s3Client.send(new PutObjectCommand(uploadParams));

      const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${fileKey}`;

      return {
        success: true,
        url: publicUrl,
      };
    } catch (error) {
      throw new Error('Error al subir archivo a S3');
    }
  }

  async uploadChatFile(file: Express.Multer.File) {
    const bucketName = this.configService.get('AWS_BUCKET_NAME');
    const region = this.configService.get('AWS_REGION');
    const folderPrefix = 'chat-uploads/';
    const fileKey = `${folderPrefix}${Date.now()}-${file.originalname}`;

    const uploadParams = {
      Bucket: bucketName,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    try {
      await this.s3Client.send(new PutObjectCommand(uploadParams));

      const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${fileKey}`;

      return {
        success: true,
        url: publicUrl,
      };
    } catch (error) {
      throw new Error('Error uploading file to S3');
    }
  }

  async uploadRecording(
    file: Express.Multer.File,
    teacherName: string,
    teacherEmail: string,
    role: string,
  ) {
    const bucketName = this.configService.get('AWS_BUCKET_NAME');
    const region = this.configService.get('AWS_REGION');

    // Use email as folder key (unique even when two teachers share a name)
    const rawFolder =
      role === 'admin'
        ? 'others'
        : (teacherEmail || teacherName || 'unknown');

    const subfolder = rawFolder.replace(/[^a-zA-Z0-9._-]/g, '_');

    const fileKey = `recordings/${subfolder}/${file.originalname}`;

    // Stream from disk — avoids loading the whole file into memory
    const stream = createReadStream(file.path);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        Body: stream,
        ContentType: 'video/webm',
      }),
    );

    // Ensure folder placeholders exist so the S3 folder structure persists
    // even if all recording files are later deleted.
    await Promise.allSettled([
      this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: 'recordings/.keep',
          Body: Buffer.from(''),
          ContentType: 'application/octet-stream',
        }),
      ),
      this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: `recordings/${subfolder}/.keep`,
          Body: Buffer.from(''),
          ContentType: 'application/octet-stream',
        }),
      ),
    ]);

    const url = `https://${bucketName}.s3.${region}.amazonaws.com/${fileKey}`;
    return { key: fileKey, url };
  }

  async listRecordings(): Promise<
    Record<string, { displayName: string; recordings: any[] }>
  > {
    const bucketName = this.configService.get('AWS_BUCKET_NAME');
    const region = this.configService.get('AWS_REGION');

    const response = await this.s3Client.send(
      new ListObjectsV2Command({ Bucket: bucketName, Prefix: 'recordings/' }),
    );

    const items = (response.Contents || [])
      .filter((obj) => obj.Key !== 'recordings/' && !obj.Key.endsWith('/.keep'))
      .map((obj) => {
        const parts = obj.Key.split('/');
        const teacher = parts[1] || 'unknown';
        const filename = parts.slice(2).join('/');
        return {
          key: obj.Key,
          teacher,
          filename,
          size: obj.Size,
          lastModified: obj.LastModified,
          url: `https://${bucketName}.s3.${region}.amazonaws.com/${obj.Key}`,
        };
      });

    // Group by teacher folder key
    const grouped = items.reduce(
      (acc, item) => {
        if (!acc[item.teacher]) acc[item.teacher] = [];
        acc[item.teacher].push(item);
        return acc;
      },
      {} as Record<string, typeof items>,
    );

    // Build result with human-readable display name per group.
    // Teacher filenames start with the teacher's first name (e.g. "John_Jane_2024-...webm").
    const result: Record<string, { displayName: string; recordings: any[] }> =
      {};
    for (const [key, recs] of Object.entries(grouped)) {
      let displayName: string;
      if (key === 'others') {
        displayName = 'Others';
      } else {
        // Extract first name from the first available filename
        const firstFilename = recs[0]?.filename || '';
        const firstPart = firstFilename.split('_')[0];
        // Fall back to the sanitized email key if parsing fails
        displayName = firstPart || key;
      }
      result[key] = { displayName, recordings: recs };
    }
    return result;
  }

  async deleteRecording(key: string) {
    const bucketName = this.configService.get('AWS_BUCKET_NAME');
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: bucketName, Key: key }),
    );
    return { success: true };
  }
}
