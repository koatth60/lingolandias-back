import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsBoolean()
  @IsOptional()
  darkMode?: boolean;

  @IsBoolean()
  @IsOptional()
  notificationSound?: boolean;

  @IsString()
  @IsOptional()
  language?: string;

  @IsBoolean()
  @IsOptional()
  classReminders?: boolean;

  @IsBoolean()
  @IsOptional()
  messageNotifications?: boolean;

  @IsBoolean()
  @IsOptional()
  watchedTutorial?: boolean;

  @IsBoolean()
  @IsOptional()
  cardDueReminders?: boolean;

  @IsObject()
  @IsOptional()
  courseProgress?: Record<string, boolean>;

  @IsBoolean()
  @IsOptional()
  courseAnnouncementSeen?: boolean;
}