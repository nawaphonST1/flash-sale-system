import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = Number(this.configService.get<number>('REDIS_PORT', 6379));

    this.client = new Redis({
      host,
      port,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    this.client.connect().catch((err) => {
      this.logger.warn(
        `Redis connection failed on ${host}:${port}. If using Docker, please make sure Redis is started. Error: ${err.message}`,
      );
    });
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  /**
   * Acquire atomic lock using SET key value EX ttl NX
   * Returns true if lock was acquired, false if already locked/exists
   */
  async acquireUserProductLock(
    userId: string,
    productId: string,
    ttlSeconds: number = 300,
  ): Promise<boolean> {
    const lockKey = `lock:order:${userId}:${productId}`;
    try {
      const result = await this.client.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err: any) {
      this.logger.error(`Failed to acquire Redis lock for key ${lockKey}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Release atomic lock
   */
  async releaseUserProductLock(userId: string, productId: string): Promise<void> {
    const lockKey = `lock:order:${userId}:${productId}`;
    try {
      await this.client.del(lockKey);
    } catch (err: any) {
      this.logger.error(`Failed to release Redis lock for key ${lockKey}: ${err.message}`);
    }
  }

  /**
   * Save order job status in Redis for fast status query
   */
  async setJobStatus(jobId: string, statusData: any, ttlSeconds: number = 86400): Promise<void> {
    const key = `job:status:${jobId}`;
    try {
      await this.client.set(key, JSON.stringify(statusData), 'EX', ttlSeconds);
    } catch (err: any) {
      this.logger.error(`Failed to set job status in Redis: ${err.message}`);
    }
  }

  /**
   * Get order job status from Redis
   */
  async getJobStatus(jobId: string): Promise<any | null> {
    const key = `job:status:${jobId}`;
    try {
      const raw = await this.client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err: any) {
      this.logger.error(`Failed to get job status from Redis: ${err.message}`);
      return null;
    }
  }
}
