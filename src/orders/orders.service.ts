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
   * 1. Check & acquire atomic Redis lock (prevents double submission / enforces 1 per user)
   * 2. Push job to BullMQ queue
   * 3. Return 202 Accepted response payload
   */
  async createOrder(userId: string, dto: CreateOrderDto) {
    const { productId } = dto;

    // 1. Atomic Redis Lock to prevent duplicate requests and enforce 1 order per user per product
    const acquired = await this.redisService.acquireUserProductLock(userId, productId, 600);
    if (!acquired) {
      this.logger.warn(`Duplicate or concurrent order rejected for user ${userId} on product ${productId}`);
      throw new ConflictException(
        `You have already submitted an order or have an active order for product '${productId}'. (Limit 1 per user)`,
      );
    }

    // 2. Generate unique order job ID
    const orderJobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 3. Set initial status in Redis
    await this.redisService.setJobStatus(orderJobId, {
      orderJobId,
      userId,
      productId,
      status: 'PENDING',
      message: 'Order request is queued for processing',
      createdAt: new Date().toISOString(),
    });

    // 4. Push job into BullMQ queue (Non-blocking Asynchronous processing)
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

    this.logger.log(`Enqueued order job ${orderJobId} for user ${userId}, product ${productId}`);

    return {
      status: 'PENDING',
      orderJobId,
      message: 'Order request accepted and queued for processing',
    };
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
