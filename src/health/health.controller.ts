import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import * as os from 'os';
import { RedisHealthIndicator } from './indicators/redis.health';

@Controller('health')
export class HealthController {
  private readonly instanceId = process.env.INSTANCE_ID || os.hostname();

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  /**
   * Deep Health Check: Checks Database, Redis, and Memory
   */
  @Get()
  @HealthCheck()
  async check() {
    const result = await this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.redisIndicator.isHealthy('redis'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024), // 300MB heap limit
      () => this.memory.checkRSS('memory_rss', 500 * 1024 * 1024), // 500MB RSS limit
    ]);

    return {
      ...result,
      instanceId: this.instanceId,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Liveness Probe: Quick check if backend process is alive
   */
  @Get('liveness')
  getLiveness() {
    return {
      status: 'ok',
      instanceId: this.instanceId,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness Probe: Verifies critical infrastructure (DB & Redis) readiness
   */
  @Get('readiness')
  @HealthCheck()
  async getReadiness() {
    const result = await this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.redisIndicator.isHealthy('redis'),
    ]);

    return {
      ...result,
      instanceId: this.instanceId,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
