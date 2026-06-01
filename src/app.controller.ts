import { Body, Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';
import { MailService } from './mail/mail.service';

class ContactDto {
  name: string;
  number?: string;
  email: string;
  message: string;
}

class NewsletterDto {
  email: string;
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly mailService: MailService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('contact')
  @HttpCode(HttpStatus.OK)
  async contact(@Body() body: ContactDto) {
    await this.mailService.sendContactEmail(body);
    return { message: 'Message sent successfully' };
  }

  @Post('newsletter')
  @HttpCode(HttpStatus.OK)
  async newsletter(@Body() body: NewsletterDto) {
    await this.mailService.sendNewsletterEmail(body.email);
    return { message: 'Subscription received' };
  }
}
