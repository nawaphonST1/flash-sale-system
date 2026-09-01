import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = this.redisService.getClient();
      if (!client) {
        throw new Error('Redis client is not initialized');
      }

      const start = Date.now();
      const pingResult = await client.ping();
      const latencyMs = Date.now() - start;

      if (pingResult !== 'PONG') {
        throw new Error(`Unexpected ping response: ${pingResult}`);
      }

      return this.getStatus(key, true, {
        latencyMs,
        status: 'up',
      });
    } catch (error: any) {
      const result = this.getStatus(key, false, {
        message: error.message,
        status: 'down',
      });
      throw new HealthCheckError('Redis health check failed', result);
    }
  }
}
