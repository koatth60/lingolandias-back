import { Body, Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AppService } from './app.service';
import { MailService } from './mail/mail.service';

// Undecorated fields disappear under the app-wide ValidationPipe's
// `whitelist` (it drops any property with no class-validator decorator at
// all) — these two DTOs had none, so every field would have silently gone
// missing the moment that pipe was turned on.
class ContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  number?: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;
}

class NewsletterDto {
  @IsEmail()
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
