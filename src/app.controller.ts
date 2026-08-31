import { Controller, Get, Post, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as os from 'os';
import { AppService } from './app.service';
import { Order } from './orders/entities/order.entity';
import { OrdersService } from './orders/orders.service';
import { Product } from './products/entities/product.entity';
import { ProductsService } from './products/products.service';
import { RedisService } from './redis/redis.service';
import * as productsSeedData from './products/products-seed.json';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private readonly instanceId = process.env.INSTANCE_ID || os.hostname();

  constructor(
    private readonly appService: AppService,
    private readonly redisService: RedisService,
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
    private readonly dataSource: DataSource,
    @InjectRepository(Product) private readonly productRepository: Repository<Product>,
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      instanceId: this.instanceId,
      uptime: process.uptime(),
    };
  }

  @Get('api/v1/_metrics')
  async getMetricsReport() {
    const rawMetrics = await this.redisService.getMetrics();
    const lanes = this.ordersService.getQueueLanes();

    let waiting = 0;
    let active = 0;
    let delayed = 0;
    let completed = 0;
    let failed = 0;

    for (const lane of lanes) {
      try {
        waiting += await lane.getWaitingCount();
        active += await lane.getActiveCount();
        delayed += await lane.getDelayedCount();
        completed += await lane.getCompletedCount();
        failed += await lane.getFailedCount();
      } catch (_) {}
    }

    return {
      metrics: {
        cache_hit: rawMetrics.cache_hit || 0,
        cache_miss: rawMetrics.cache_miss || 0,
        db_build: rawMetrics.db_build || 0,
        cache_wait_hit: rawMetrics.cache_wait_hit || 0,
        cache_wait_timeout: rawMetrics.cache_wait_timeout || 0,
        orders_accepted: rawMetrics.orders_accepted || 0,
        orders_soldout: rawMetrics.orders_soldout || 0,
        orders_duplicate: rawMetrics.orders_duplicate || 0,
        orders_completed: rawMetrics.orders_completed || 0,
        orders_failed: rawMetrics.orders_failed || 0,
      },
      queue: {
        waiting,
        active,
        delayed,
        completed,
        failed,
      },
    };
  }

  @Post('api/v1/admin/reset')
  async resetAllData() {
    this.logger.log(`[Reset] Resetting flash sale database and Redis stock...`);

    const rawData = (
      Array.isArray(productsSeedData)
        ? productsSeedData
        : (productsSeedData as any).default || []
    ) as any[];

    // 1. Reset PostgreSQL Master Database
    try {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      for (const item of rawData) {
        const available = Number(item.availableStock);
        await runner.query(
          `UPDATE products SET "availableStock" = $1, "remainingStock" = $2 WHERE "productId" = $3`,
          [available, available, item.productId],
        );
      }
      await runner.query(`DELETE FROM orders`);
      await runner.release();
    } catch (err: any) {
      this.logger.warn(`Postgres DB reset update: ${err.message}`);
    }

    // 2. Reset Redis Stock and clean locks/metrics
    for (const item of rawData) {
      const available = Number(item.availableStock);
      await this.redisService.getClient().set(`stock:${item.productId}`, available.toString());
      await this.redisService.del(`product:${item.productId}`);
    }

    await this.redisService.delByPattern('lock:order:*');
    await this.redisService.delByPattern('products:page:*');
    await this.redisService.del('metrics:flash_sale');

    // 3. Clear all 10 Sharded Queue Lanes
    const lanes = this.ordersService.getQueueLanes();
    for (const lane of lanes) {
      try {
        await lane.drain();
        await lane.clean(0, 1000, 'completed');
        await lane.clean(0, 1000, 'failed');
      } catch (_) {}
    }

    // 4. Pre-warm Redis cache for all 7 pagination keys immediately
    await this.productsService.warmupPaginationCache();

    return {
      status: 'success',
      message: 'Flash sale database, Redis stock, and 10 Sharded Queue lanes have been reset and pre-warmed successfully.',
    };
  }
}

