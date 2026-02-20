import { IsBoolean, IsOptional, IsString } from 'class-validator';

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
}