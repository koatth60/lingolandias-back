import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsString } from 'class-validator';
import { MailService } from './mail.service';
import { AuthGuard } from 'src/auth/guards/auth.guard';

// Undecorated fields disappear under the app-wide ValidationPipe's
// `whitelist` (it drops any property with no class-validator decorator at
// all) — this DTO had none, so every field would have silently gone missing
// the moment that pipe was turned on.
class SupportEmailDto {
  @IsString()
  name: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  language: string;

  @IsString()
  subject: string;

  @IsString()
  message: string;
}

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @UseGuards(AuthGuard)
  @Post('support')
  async sendSupport(@Body() body: SupportEmailDto) {
    await this.mailService.sendSupportEmail(body);
    return { message: 'Support request sent successfully' };
  }
}
