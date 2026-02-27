
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as ejs from 'ejs';
import * as path from 'path';

import { config as dotenvConfig } from 'dotenv';
import { MailerService } from '@nestjs-modules/mailer';
dotenvConfig({ path: '.env.development.development' });

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private mailerService: MailerService) {}

  public async sendUserWelcomeEmail(
    name: string,
    email: string,
    password: string,
  ) {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Welcome to Lingolandias',
        template: './welcome',
        context: {
          email: email,
          name: name,
          password: password,
        },
      });
      this.logger.log(`Welcome email sent to ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send welcome email to ${email}`,
        error.stack,
      );
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  public async sendUserResetPasswordEmail(
    name: string,
    email: string,
    resetUrl: string,
  ) {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Password Reset Request',
        template: './password-reset',
        context: {
          name: name,
          resetUrl: resetUrl,
        },
      });

      this.logger.log(`[DEBUG] Password reset email simulated for ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${email}`, error.stack);
      throw new InternalServerErrorException('Email service unavailable');
    }
  }

  public async sendPasswordChangedEmail(name: string, email: string) {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Your password was changed',
        template: './password-changed',
        context: {
          name: name,
        },
      });
      this.logger.log(`Password changed email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password changed email to ${email}`, error.stack);
    }
  }

  public async sendSupportEmail(data: {
    name: string;
    lastName: string;
    email: string;
    language: string;
    subject: string;
    message: string;
  }) {
    try {
      await this.mailerService.sendMail({
        to: 'agata@lingolandias.net',
        subject: `Lingolandias Platform Support - ${data.subject}`,
        template: './support-request',
        context: {
          name: data.name,
          lastName: data.lastName,
          email: data.email,
          language: data.language,
          subject: data.subject,
          message: data.message,
        },
      });
      this.logger.log(`Support email sent from ${data.email}`);
    } catch (error) {
      this.logger.error(`Failed to send support email from ${data.email}`, error.stack);
      throw new InternalServerErrorException('Failed to send support email');
    }
  }
}
