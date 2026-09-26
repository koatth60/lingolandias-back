import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ClassSessionsService } from './class-sessions.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// These rows feed the teacher-hours analytics. Until 2026-09-26 the routes
// had no guard: anyone could start sessions under any teacherId and end them
// with any durationMinutes, i.e. invent teaching hours.
@UseGuards(AuthGuard, RolesGuard)
@Controller('class-sessions')
export class ClassSessionsController {
  constructor(private readonly service: ClassSessionsService) {}

  @Post('start')
  @Roles('teacher')
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser('id') teacherId: string, @Body() body: any) {
    return this.service.startSession({ ...body, teacherId });
  }

  @Post('heartbeat/:sessionId')
  @Roles('teacher')
  @HttpCode(HttpStatus.OK)
  heartbeat(@CurrentUser('id') teacherId: string, @Param('sessionId') sessionId: string) {
    return this.service.heartbeat(sessionId, teacherId);
  }

  @Post('end/:sessionId')
  @Roles('teacher')
  @HttpCode(HttpStatus.OK)
  end(
    @CurrentUser('id') teacherId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: any,
  ) {
    return this.service.endSession(sessionId, teacherId, Number(body?.durationMinutes) || 0);
  }

  @Get('analytics')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  analytics() {
    return this.service.getAnalytics();
  }
}
