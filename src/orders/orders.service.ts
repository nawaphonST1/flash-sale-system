import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { Product } from '../products/entities/product.entity';
import { RedisService } from '../redis/redis.service';
import { CreateOrderDto } from './dto/create-order.dto';

export const ORDER_LANE_COUNT = 10;
export const ORDER_LANE_PREFIX = 'order-queue';

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersService.name);
  private queueLanes: Queue[] = [];

  constructor(
    @InjectRepository(Product) private readonly productRepository: Repository<Product>,
    private readonly redisService: RedisService,
    @Optional()
    @InjectMetric('flash_sale_orders_total')
    private readonly ordersCounter?: Counter<string>,
    @Optional()
    @InjectMetric('flash_sale_queue_jobs_total')
    private readonly queueJobsCounter?: Counter<string>,
  ) {}

  onModuleInit() {
    for (let i = 0; i < ORDER_LANE_COUNT; i++) {
      this.queueLanes.push(
        new Queue(`${ORDER_LANE_PREFIX}-${i}`, {
          connection: this.redisService.getClient(),
        }),
      );
    }
  }

  async onModuleDestroy() {
    await Promise.all(this.queueLanes.map((q) => q.close()));
  }

  getQueueLanes(): Queue[] {
    return this.queueLanes;
  }

  private getLaneIndex(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash << 5) - hash + userId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % ORDER_LANE_COUNT;
  }

  /**
   * Process incoming order request:
   * 1. Check Idempotency Key
   * 2. Atomic Lock + Stock Check + Decrement via single Redis Lua script (1 roundtrip)
   * 3. Push job into designated Sharded Queue Lane
   * 4. Return 202 Accepted response payload
   */
  async createOrder(userId: string, dto: CreateOrderDto, idempotencyKey?: string) {
    const { productId } = dto;

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existingResponse = await this.redisService.get(`idempotency:${userId}:${idempotencyKey}`);
      if (existingResponse) {
        try {
          this.logger.log(`Idempotent request detected for user ${userId} with key ${idempotencyKey}. Returning cached response.`);
          return JSON.parse(existingResponse);
        } catch (err: any) {
          this.logger.warn(`Failed to parse cached idempotency response: ${err.message}`);
        }
      }
    }

    // 2. Atomic Lock + Stock Check + Decrement via single Redis Lua script (1 roundtrip EVALSHA)
    let claimResult = await this.redisService.claimFlashSaleOrder(userId, productId, 600);

    if (claimResult === -2) {
      // Fallback: If stock key missing in Redis, sync from DB and retry
      const product = await this.productRepository.findOne({ where: { productId } });
      const initialStock = product ? product.availableStock : 0;
      await this.redisService.initProductStock(productId, initialStock);
      claimResult = await this.redisService.claimFlashSaleOrder(userId, productId, 600);
    }

    if (claimResult === -3) {
      this.ordersCounter?.inc({ status: 'duplicate_request' });
      throw new ConflictException(
        `You have already submitted an order or have an active order for product '${productId}'. (Limit 1 per user)`,
      );
    }

    if (claimResult === -1 || claimResult < 0) {
      this.ordersCounter?.inc({ status: 'out_of_stock' });
      throw new ConflictException('Product sold out');
    }

    this.ordersCounter?.inc({ status: 'accepted' });

    // 3. Generate deterministic order job ID
    const orderJobId = `order:${userId}:${productId}`;

    // 4. Push job into designated Sharded Queue Lane
    const lane = this.getLaneIndex(userId);
    const targetQueue = this.queueLanes[lane] || this.queueLanes[0];

    await targetQueue.add(
      'process-order',
      {
        orderJobId,
        userId,
        productId,
      },
      {
        jobId: orderJobId,
        removeOnComplete: {
          count: 1000,
          age: 3600,
        },
        removeOnFail: {
          count: 5000,
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 500,
        },
      },
    );

    this.queueJobsCounter?.inc({ queue: 'order_lane', status: 'enqueued' });

    const responsePayload = {
      status: 'processing',
      orderJobId,
      message: 'Order request accepted and queued for processing',
    };

    if (idempotencyKey) {
      await this.redisService.set(
        `idempotency:${userId}:${idempotencyKey}`,
        JSON.stringify(responsePayload),
        86400,
      );
    }

    return responsePayload;
  }

  /**
   * Check order job status by job ID
   */
  async getOrderStatus(orderJobId: string) {
    const status = await this.redisService.getJobStatus(orderJobId);
    if (status) {
      return status;
    }

    for (const queue of this.queueLanes) {
      const job = await queue.getJob(orderJobId);
      if (job) {
        const state = await job.getState();
        return {
          orderJobId,
          status: state.toUpperCase(),
          data: job.data,
          returnvalue: job.returnvalue,
          failedReason: job.failedReason,
        };
      }
    }

    return {
      orderJobId,
      status: 'UNKNOWN',
      message: 'Order job not found',
    };
  }
}
