import { Controller, Get, Post, Delete, Body, UseGuards, Req } from '@nestjs/common';
import { PushService } from './push.service';
import { AuthGuard } from 'src/auth/guards/auth.guard';

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return this.pushService.getVapidPublicKey();
  }

  @UseGuards(AuthGuard)
  @Post('subscribe')
  subscribe(@Req() req, @Body() body: any) {
    return this.pushService.saveSubscription(req.user.id, body);
  }

  @UseGuards(AuthGuard)
  @Delete('unsubscribe')
  unsubscribe(@Req() req) {
    return this.pushService.removeSubscription(req.user.id);
  }
}
