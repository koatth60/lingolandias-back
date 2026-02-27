import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { MailService } from './mail.service';
import { AuthGuard } from 'src/auth/guards/auth.guard';

class SupportEmailDto {
  name: string;
  lastName: string;
  email: string;
  language: string;
  subject: string;
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
