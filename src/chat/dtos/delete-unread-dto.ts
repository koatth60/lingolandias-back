import { IsOptional, IsString } from 'class-validator';

// Undecorated fields disappear under the app-wide ValidationPipe's
// `whitelist` (it drops any property with no class-validator decorator at
// all) — this DTO had none. `userId` is no longer read by the controller
// (the caller's own id from the token is used instead), but the frontend
// still sends it, so it stays here — and decorated, or forbidNonWhitelisted
// would reject the request outright the day that gets turned on.
export class DeleteUnreadDto {
  @IsString()
  room: string;

  @IsOptional()
  @IsString()
  userId?: string;
}
