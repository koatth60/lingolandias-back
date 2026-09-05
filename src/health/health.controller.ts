import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      // Flags if the process is leaking memory toward an OOM restart, not a
      // hard limit — 500MB is generous headroom above this app's normal footprint.
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
    ]);
  }
}
