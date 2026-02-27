export class ChangePasswordDto {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}
