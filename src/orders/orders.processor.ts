import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Worker } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { Product } from '../products/entities/product.entity';
import { RedisService } from '../redis/redis.service';
import { Order, OrderStatus } from './entities/order.entity';
import { ORDER_LANE_COUNT, ORDER_LANE_PREFIX } from './orders.service';

interface OrderJobData {
  orderJobId: string;
  userId: string;
  productId: string;
}

@Injectable()
export class OrdersProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersProcessor.name);
  private workers: Worker[] = [];

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    @Optional()
    @InjectMetric('flash_sale_orders_total')
    private readonly ordersCounter?: Counter<string>,
    @Optional()
    @InjectMetric('flash_sale_queue_jobs_total')
    private readonly queueJobsCounter?: Counter<string>,
  ) {}

  onModuleInit() {
    if (process.env.ROLE !== 'worker') {
      this.logger.log('Skipping OrdersProcessor worker initialization (ROLE is not worker).');
      return;
    }

    for (let i = 0; i < ORDER_LANE_COUNT; i++) {
      const queueName = `${ORDER_LANE_PREFIX}-${i}`;
      const worker = new Worker(
        queueName,
        async (job: Job<OrderJobData>) => this.processOrder(job),
        {
          connection: this.redisService.getClient(),
          concurrency: 5,
        },
      );
      this.workers.push(worker);
    }
    this.logger.log(`Initialized ${ORDER_LANE_COUNT} Sharded Order Queue Workers (50 concurrent total).`);
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
  }

  async processOrder(job: Job<OrderJobData>): Promise<any> {
    const { orderJobId, userId, productId } = job.data;
    this.logger.log(`[Worker] Processing order job ${orderJobId} for user ${userId}, product ${productId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Check if user has already bought this product in DB (Double protection)
      const existingOrder = await queryRunner.manager.findOne(Order, {
        where: { userId, productId, status: OrderStatus.CONFIRMED },
      });

      if (existingOrder) {
        throw new Error('User already has a confirmed order for this product.');
      }

      // 2. Lock & Check product row in DB for atomic stock decrement
      const product = await queryRunner.manager.findOne(Product, {
        where: { productId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!product) {
        throw new Error(`Product '${productId}' not found.`);
      }

      if (!product.isFlashSaleActive) {
        throw new Error(`Flash sale is not active for product '${productId}'.`);
      }

      if (product.availableStock <= 0) {
        throw new Error(`Product '${productId}' is out of stock.`);
      }

      // 3. Decrement stock
      product.availableStock -= 1;
      product.remainingStock = Math.max(0, (product.remainingStock ?? product.availableStock + 1) - 1);
      await queryRunner.manager.save(Product, product);

      // Invalidate single product item cache
      this.redisService.del(`product:${productId}`).catch(() => {});

      // 4. Create confirmed order record
      const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newOrder = queryRunner.manager.create(Order, {
        orderId,
        userId,
        productId,
        quantity: 1,
        price: product.price,
        totalAmount: product.price,
        status: OrderStatus.CONFIRMED,
        failureReason: null,
      });

      const savedOrder = await queryRunner.manager.save(Order, newOrder);

      // Commit transaction
      await queryRunner.commitTransaction();

      // 5. Update Redis Job Status
      const successResult = {
        orderJobId,
        orderId: savedOrder.orderId,
        userId,
        productId,
        productName: product.name,
        price: savedOrder.price,
        status: OrderStatus.CONFIRMED,
        message: 'Order processed and confirmed successfully',
        completedAt: new Date().toISOString(),
      };

      await this.redisService.setJobStatus(orderJobId, successResult);
      await this.redisService.incrMetric('orders_completed');
      this.ordersCounter?.inc({ status: 'confirmed' });
      this.queueJobsCounter?.inc({ queue: 'order_lane', status: 'completed' });
      this.logger.log(`[Worker] Order ${savedOrder.orderId} CONFIRMED for job ${orderJobId}`);

      return successResult;
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      await this.redisService.incrMetric('orders_failed');
      this.ordersCounter?.inc({ status: 'failed' });
      this.queueJobsCounter?.inc({ queue: 'order_lane', status: 'failed' });

      this.logger.error(`[Worker] Order processing FAILED for job ${orderJobId}: ${err.message}`);

      // Save failed order record for audit
      try {
        const failedOrderId = `ord_fail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const failedOrder = this.orderRepository.create({
          orderId: failedOrderId,
          userId,
          productId,
          quantity: 1,
          price: 0,
          totalAmount: 0,
          status: OrderStatus.FAILED,
          failureReason: err.message,
        });
        await this.orderRepository.save(failedOrder);
      } catch (saveErr: any) {
        this.logger.warn(`Could not save failed order audit record: ${saveErr.message}`);
      }

      // Update Redis Job Status with failure
      const failureResult = {
        orderJobId,
        userId,
        productId,
        status: OrderStatus.FAILED,
        error: err.message,
        completedAt: new Date().toISOString(),
      };

      await this.redisService.setJobStatus(orderJobId, failureResult);

      // Release lock on failure so user might retry if valid
      await this.redisService.releaseUserProductLock(userId, productId);

      return failureResult;
    } finally {
      await queryRunner.release();
    }
  }
}
