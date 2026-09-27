import { IsString, MinLength } from 'class-validator';

// The account is always the caller's (taken from the token by the controller),
// so there is deliberately no userId field here.
//
// Undecorated fields disappear under the app-wide ValidationPipe's
// `whitelist` (it drops any property with no class-validator decorator at
// all) — this DTO had none, so every field would have silently gone missing
// the moment that pipe was turned on. newPassword's MinLength matches
// ResetPasswordDto's, closing the gap where a reset link enforced a real
// password but this route didn't.
export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;

  @IsString()
  confirmPassword: string;
}
