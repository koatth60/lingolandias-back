import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthGuard } from './guards/auth.guard';
import { Roles, RolesGuard } from './guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// The app-wide default (120 req/min per IP, see AppModule) covers ordinary
// traffic; these routes get their own tighter budget because they're either
// a password-guessing target (login, change-password) or send an email per
// call (register was already admin-gated in Phase 0; forgot-password and
// resend-friendly reset/register still want their own ceiling so a script
// can't mail-bomb an inbox or brute-force a login for anyone's account).
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Admin-only: accounts are created from the admin panel (UserModal).
  // This route used to be public and saved the request body as-is, so anyone
  // on the internet could POST { role: 'admin', ... } and get an admin account.
  @Post('register')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async register(@Body() newUser: any) {
    return this.authService.register(newUser);
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async login(@Body() credentials: any) {
    const { email, password } = credentials;
    return this.authService.login(email, password);
  }

  // The user comes from the token. This used to take `userId` from the body
  // with no guard and return the whole user row, password hash included, to
  // anyone who knew a user id.
  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser('id') userId: string) {
    return this.authService.logout(userId);
  }

  @Post('refresh')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: any) {
    return this.authService.refresh(req.user.id);
  }

  @Post('forgot-password')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  @Throttle(AUTH_THROTTLE)
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.setNewPassword(
      resetPasswordDto.token,
      resetPasswordDto.password,
      resetPasswordDto.confirmPassword,
    );
  }

  // Same fix as logout: the account whose password changes is the caller's,
  // never one named in the body.
  @Post('change-password')
  @Throttle(AUTH_THROTTLE)
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      userId,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
      changePasswordDto.confirmPassword,
    );
  }

  @Get('verify-reset-token/:token')
  async verifyResetToken(@Param('token') token: string) {
    return this.authService.verifyResetToken(token);
  }
}
