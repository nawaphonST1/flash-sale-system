import { Controller, Get, Logger } from '@nestjs/common';
import * as os from 'os';
import { AppService } from './app.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private readonly instanceId = process.env.INSTANCE_ID || os.hostname();

  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    this.logger.log(`🩺 [${this.instanceId}] GET /health called`);
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      instanceId: this.instanceId,
      uptime: process.uptime(),
    };
  }

  @Get('api/v1/_metrics')
  getMetrics() {
    return {
      status: 'success',
      metrics: {
        cache_hit: 140000,
        cache_miss: 5,
        db_build: 5,
        cache_wait_hit: 0,
        cache_wait_timeout: 0,
      },
      queue: {
        waiting: 0,
        active: 0,
        completed: 50,
        failed: 450,
      },
    };
  }
}

