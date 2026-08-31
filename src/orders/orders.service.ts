import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { CreateOrderDto } from './dto/create-order.dto';

export const ORDER_QUEUE_NAME = 'order-queue';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectQueue(ORDER_QUEUE_NAME) private readonly orderQueue: Queue,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Process incoming order request:
   * 1. Check Idempotency Key (returns cached response if already submitted)
   * 2. Check & acquire atomic Redis lock (prevents double submission / enforces 1 per user)
   * 3. Push job to BullMQ queue
   * 4. Save Idempotency response in Redis
   * 5. Return 202 Accepted response payload
   */
  async createOrder(userId: string, dto: CreateOrderDto, idempotencyKey?: string) {
    const { productId } = dto;

    // 1. Idempotency Check: if idempotency key is provided, check if response was already generated
    if (idempotencyKey) {
      const existingResponse = await this.redisService.get(`idempotency:${userId}:${idempotencyKey}`);
      if (existingResponse) {
        try {
          return JSON.parse(existingResponse);
        } catch {}
      }
    }

    // 2. Atomic Redis Lock to prevent duplicate requests and enforce 1 order per user per product
    const acquired = await this.redisService.acquireUserProductLock(userId, productId, 600);
    if (!acquired) {
      throw new ConflictException(
        `You have already submitted an order or have an active order for product '${productId}'. (Limit 1 per user)`,
      );
    }

    // 3. Fast-path: Atomic Stock Check & Decrement via Redis Lua Script
    // If stock is depleted (returns -1 or -2), reject immediately without burdening BullMQ or PostgreSQL
    const remainingStock = await this.redisService.decrementProductStockAtomic(productId);
    if (remainingStock < 0) {
      // Release lock so user is not stuck on a failed attempt
      await this.redisService.releaseUserProductLock(userId, productId);
      throw new ConflictException('Product sold out');
    }

    // 4. Generate unique order job ID
    const orderJobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 5. Push job into BullMQ queue (Non-blocking Asynchronous processing)
    await this.orderQueue.add(
      'process-order',
      {
        orderJobId,
        userId,
        productId,
      },
      {
        jobId: orderJobId,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Set initial status in Redis in background (non-blocking)
    this.redisService
      .setJobStatus(orderJobId, {
        orderJobId,
        userId,
        productId,
        status: 'PENDING',
        message: 'Order request is queued for processing',
        createdAt: new Date().toISOString(),
      })
      .catch(() => {});

    const responsePayload = {
      status: 'processing',
      orderJobId,
      message: 'Your order is in the queue.',
    };

    // 6. Save Idempotency response in Redis (TTL 24 hours)
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

    const job = await this.orderQueue.getJob(orderJobId);
    if (!job) {
      return {
        orderJobId,
        status: 'UNKNOWN',
        message: 'Order job not found',
      };
    }

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
