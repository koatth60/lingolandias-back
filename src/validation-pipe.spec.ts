import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './auth/dto/change-password.dto';
import { ResetPasswordDto } from './auth/dto/reset-password.dto';
import { DeleteUnreadDto } from './chat/dtos/delete-unread-dto';

/**
 * Guards the global ValidationPipe added 2026-09-27 against the exact
 * failure mode it risked: `whitelist: true` silently drops every property of
 * a DTO class that has NO class-validator decorators at all, regardless of
 * `forbidNonWhitelisted`. Each of these classes had none before this — this
 * locks in that they now survive whitelist unchanged for the fields the
 * frontend actually sends.
 */

const survivesWhitelist = async (cls: new () => object, payload: Record<string, unknown>) => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  return pipe.transform(payload, { type: 'body', metatype: cls } as any);
};

describe('DTOs decorated for the app-wide whitelist (2026-09-27)', () => {
  it('ContactDto keeps every field the contact form sends', async () => {
    const mod: any = await import('./app.controller');
    const ContactDto = Object.values(mod).find(
      (v: any) => typeof v === 'function' && v.name === 'ContactDto',
    ) as new () => object;
    const payload = { name: 'A', number: '123', email: 'a@b.com', message: 'hi' };
    const result = await survivesWhitelist(ContactDto, payload);
    expect(result).toEqual(payload);
  });

  it('SupportEmailDto keeps every field the support form sends', async () => {
    const mod: any = await import('./mail/mail.controller');
    const SupportEmailDto = Object.values(mod).find(
      (v: any) => typeof v === 'function' && v.name === 'SupportEmailDto',
    ) as new () => object;
    const payload = { name: 'A', lastName: 'B', email: 'a@b.com', language: 'es', subject: 's', message: 'm' };
    const result = await survivesWhitelist(SupportEmailDto, payload);
    expect(result).toEqual(payload);
  });

  it('ChangePasswordDto keeps its fields and enforces the same 8-char minimum as reset', async () => {
    const payload = { currentPassword: 'old', newPassword: 'newpass1', confirmPassword: 'newpass1' };
    const result = await survivesWhitelist(ChangePasswordDto, payload);
    expect(result).toEqual(payload);

    const instance = plainToInstance(ChangePasswordDto, { ...payload, newPassword: 'short' });
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('DeleteUnreadDto keeps room and the still-sent (now unused) userId', async () => {
    const payload = { room: 'uuid-support', userId: 'u1' };
    const result = await survivesWhitelist(DeleteUnreadDto, payload);
    expect(result).toEqual(payload);
  });

  it('ResetPasswordDto actually rejects a short password now that a pipe is bound', async () => {
    const instance = plainToInstance(ResetPasswordDto, {
      token: 't',
      password: 'short',
      confirmPassword: 'short',
    });
    const errors = await validate(instance);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
