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

    // Define claimFlashSaleOrder command (auto EVALSHA, 1 Network Roundtrip)
    this.client.defineCommand('claimFlashSaleOrder', {
      numberOfKeys: 3,
      lua: `
        -- KEYS[1]: lock:order:userId:productId
        -- KEYS[2]: stock:productId
        -- KEYS[3]: metrics:flash_sale
        -- ARGV[1]: lockTtlSeconds

        -- 1. Check duplicate lock
        if redis.call('EXISTS', KEYS[1]) == 1 then
          redis.call('HINCRBY', KEYS[3], 'orders_duplicate', 1)
          return -3
        end

        -- 2. Check stock existence
        local stock = redis.call('GET', KEYS[2])
        if not stock then
          return -2
        end

        local stockNum = tonumber(stock)
        if stockNum <= 0 then
          redis.call('HINCRBY', KEYS[3], 'orders_soldout', 1)
          return -1
        end

        -- 3. Atomic lock & decrement stock & increment accepted metrics
        redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
        local remaining = redis.call('DECRBY', KEYS[2], 1)
        if remaining < 0 then
          -- Rollback if concurrency overshoot
          redis.call('INCRBY', KEYS[2], 1)
          redis.call('DEL', KEYS[1])
          redis.call('HINCRBY', KEYS[3], 'orders_soldout', 1)
          return -1
        end

        redis.call('HINCRBY', KEYS[3], 'orders_accepted', 1)
        return remaining
      `,
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
   * Delete keys matching a pattern using SCAN stream and UNLINK (Non-blocking)
   */
  async delByPattern(pattern: string): Promise<void> {
    try {
      const stream = this.client.scanStream({
        match: pattern,
        count: 100,
      });

      return new Promise<void>((resolve, reject) => {
        stream.on('data', async (keys: string[]) => {
          if (keys && keys.length > 0) {
            stream.pause();
            try {
              await this.client.unlink(...keys);
            } catch (err: any) {
              this.logger.error(`Error unlinking keys in pattern '${pattern}': ${err.message}`);
            } finally {
              stream.resume();
            }
          }
        });

        stream.on('end', () => {
          resolve();
        });

        stream.on('error', (err) => {
          this.logger.error(`SCAN stream error for pattern '${pattern}': ${err.message}`);
          reject(err);
        });
      });
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
   * Atomic Lock + Stock Check + Decrement in 1 single Lua script on Redis (via EVALSHA)
   * Returns:
   *  >= 0: Order accepted, returns remaining stock
   *  -1: Product sold out
   *  -2: Stock not initialized
   *  -3: User already has lock / duplicate order
   */
  async claimFlashSaleOrder(
    userId: string,
    productId: string,
    lockTtlSeconds: number = 600,
  ): Promise<number> {
    const lockKey = `lock:order:${userId}:${productId}`;
    const stockKey = `stock:${productId}`;
    const metricsKey = 'metrics:flash_sale';

    try {
      // Use defined EVALSHA command on client
      const result = await (this.client as any).claimFlashSaleOrder(
        lockKey,
        stockKey,
        metricsKey,
        lockTtlSeconds.toString(),
      );
      return Number(result);
    } catch (err: any) {
      this.logger.error(`Failed executing claimFlashSaleOrder for user ${userId}, product ${productId}: ${err.message}`);
      throw err;
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

  /**
   * Increment metric counter in Redis
   */
  async incrMetric(metricName: string): Promise<void> {
    try {
      await this.client.hincrby('metrics:flash_sale', metricName, 1);
    } catch (_) {}
  }

  /**
   * Get all live metrics from Redis
   */
  async getMetrics(): Promise<Record<string, number>> {
    try {
      const raw = await this.client.hgetall('metrics:flash_sale');
      const res: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        res[k] = Number(v) || 0;
      }
      return res;
    } catch (_) {
      return {};
    }
  }
}


