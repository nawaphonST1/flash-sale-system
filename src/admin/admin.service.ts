import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { RedisService } from '../redis/redis.service';
import * as productsSeedData from '../products/products-seed.json';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly redisService: RedisService,
    private readonly productsService: ProductsService,
    private readonly dataSource: DataSource,
  ) {}

  async resetSystem(): Promise<{ message: string; success: boolean; timestamp: string }> {
    this.logger.log('Initiating system reset...');

    // 1. Clear PostgreSQL database tables
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.query('TRUNCATE TABLE "orders" CASCADE;');
      await queryRunner.manager.query('TRUNCATE TABLE "products" CASCADE;');

      const rawData = (
        Array.isArray(productsSeedData)
          ? productsSeedData
          : (productsSeedData as any).default || []
      ) as any[];

      if (rawData.length > 0) {
        const productData = rawData.map((item) => ({
          productId: String(item.productId),
          name: String(item.name),
          description: String(item.description || ''),
          price: Number(item.price),
          availableStock: Number(item.availableStock),
          remainingStock: Number(item.remainingStock ?? item.availableStock),
          isFlashSaleActive: Boolean(item.isFlashSaleActive),
        }));
        const entities = queryRunner.manager.create(Product, productData);
        await queryRunner.manager.save(Product, entities);
      }

      await queryRunner.commitTransaction();
      this.logger.log('PostgreSQL database reset complete.');
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to reset database: ${err.message}`);
      throw err;
    } finally {
      await queryRunner.release();
    }

    // 2. Clear Redis cache, locks, stocks, BullMQ queue keys, and metrics
    const redisClient = this.redisService.getClient();
    try {
      await redisClient.flushdb();
      this.logger.log('Redis flushed successfully.');
    } catch (err: any) {
      this.logger.warn(`Redis flushdb error: ${err.message}`);
    }

    // 3. Re-seed products stock into Redis and pre-warm cache
    await this.productsService.seedProducts();

    return {
      message: 'System reset successfully. Stock reset, orders cleared, Redis refreshed.',
      success: true,
      timestamp: new Date().toISOString(),
    };
  }
}
