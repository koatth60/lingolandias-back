import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ClassSessionsService } from './class-sessions.service';

@Controller('class-sessions')
export class ClassSessionsController {
  constructor(private readonly service: ClassSessionsService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  start(@Body() body: any) {
    return this.service.startSession(body);
  }

  @Post('heartbeat/:sessionId')
  @HttpCode(HttpStatus.OK)
  heartbeat(@Param('sessionId') sessionId: string) {
    return this.service.heartbeat(sessionId);
  }

  @Post('end/:sessionId')
  @HttpCode(HttpStatus.OK)
  end(@Param('sessionId') sessionId: string, @Body() body: any) {
    return this.service.endSession(sessionId, body.durationMinutes ?? 0);
  }

  @Get('analytics')
  @HttpCode(HttpStatus.OK)
  analytics() {
    return this.service.getAnalytics();
  }
}
