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


  /**
   * Generic get cache
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err: any) {
      this.logger.error(`Failed to get key '${key}' from Redis: ${err.message}`);
      return null;
    }
  }

  /**
   * Generic set cache with optional TTL in seconds
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err: any) {
      this.logger.error(`Failed to set key '${key}' in Redis: ${err.message}`);
    }
  }

  /**
   * Generic del cache
   */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err: any) {
      this.logger.error(`Failed to delete key '${key}' from Redis: ${err.message}`);
    }
  }

  /**
   * Delete keys matching a pattern using UNLINK (Instant & reliable)
   */
  async delByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys && keys.length > 0) {
        await this.client.unlink(...keys);
      }
    } catch (err: any) {
      this.logger.error(`Failed to delete pattern '${pattern}' from Redis: ${err.message}`);
    }
  }

  /**
   * Initialize product stock in Redis if not already set
   */
  async initProductStock(productId: string, initialStock: number): Promise<void> {
    const key = `stock:${productId}`;
    try {
      await this.client.setnx(key, initialStock.toString());
    } catch (err: any) {
      this.logger.error(`Failed to init stock for product ${productId}: ${err.message}`);
    }
  }

  /**
   * Atomic Stock Decrement via Redis Lua Script
   * Returns:
   *  >= 0: Remaining stock after decrement (Success)
   *  -1: Out of stock (Remaining was 0 or less)
   *  -2: Stock key not initialized
   */
  async decrementProductStockAtomic(productId: string): Promise<number> {
    const key = `stock:${productId}`;
    const luaScript = `
      local stock = redis.call('GET', KEYS[1])
      if not stock then
        return -2
      end
      local stockNum = tonumber(stock)
      if stockNum <= 0 then
        return -1
      end
      return redis.call('DECRBY', KEYS[1], 1)
    `;

    try {
      const result = (await this.client.eval(luaScript, 1, key)) as number;
      return result;
    } catch (err: any) {
      this.logger.error(`Failed executing Lua script for stock decrement on ${productId}: ${err.message}`);
      throw err;
    }
  }
}

