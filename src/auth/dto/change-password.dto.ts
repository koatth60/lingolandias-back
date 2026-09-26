// The account is always the caller's (taken from the token by the controller),
// so there is deliberately no userId field here.
export class ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}
