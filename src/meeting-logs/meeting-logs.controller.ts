import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { MeetingLogsService } from './meeting-logs.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Both routes used to be open to anyone on the internet: GET returned every
// participant's name, email, user id and browser, and a forged POST of a
// `recording_started` event could redirect a group's Jibri recording into
// someone else's folder (see MeetingLogsService.findLastRecorder).
@UseGuards(AuthGuard)
@Controller('meeting-logs')
export class MeetingLogsController {
  constructor(private readonly service: MeetingLogsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  create(@CurrentUser() caller: AuthenticatedUser, @Body() body: any) {
    // Identity fields come from the token, whatever the payload says.
    const entries = (Array.isArray(body) ? body : [body])
      .slice(0, 50)
      .map((e) => (e && typeof e === 'object' ? { ...e, userId: caller.id, email: caller.email } : e));
    return this.service.create(entries);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  find(@Query() query: any) {
    return this.service.find(query);
  }
}
