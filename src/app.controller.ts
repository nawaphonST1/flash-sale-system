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
}

