import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { MeetingLogsService } from './meeting-logs.service';

@Controller('meeting-logs')
export class MeetingLogsController {
  constructor(private readonly service: MeetingLogsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  find(@Query() query: any) {
    return this.service.find(query);
  }
}
