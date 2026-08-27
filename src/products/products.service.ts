import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { Product } from './entities/product.entity';
import * as productsSeedData from './products-seed.json';

export interface PaginatedProductsResponse {
  status: string;
  data: Array<{
    productId: string;
    name: string;
    price: number;
    availableStock: number;
    remainingStock: number;
    isFlashSaleActive: boolean;
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);
  private readonly CACHE_TTL_SECONDS = 60;

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    try {
      await this.seedProducts();
    } catch (err: any) {
      this.logger.warn(`Could not seed products automatically: ${err.message}`);
    }
  }

  async seedProducts() {
    const count = await this.productRepository.count();
    if (count === 0) {
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
        const entities = this.productRepository.create(productData);
        await this.productRepository.save(entities);
        this.logger.log(`Successfully seeded ${entities.length} products to database.`);
      }

    }
  }

  async findAllPaginated(page: number = 1, limit: number = 10): Promise<PaginatedProductsResponse> {
    const cacheKey = `products:page:${page}:limit:${limit}`;

    // 1. Check Redis Cache (Cache-Aside)
    const cachedData = await this.redisService.get(cacheKey);
    if (cachedData) {
      try {
        return JSON.parse(cachedData) as PaginatedProductsResponse;
      } catch (err: any) {
        this.logger.warn(`Failed to parse cache for key ${cacheKey}: ${err.message}`);
      }
    }

    // 2. Query Database on Cache MISS
    const skip = (page - 1) * limit;
    const [items, total] = await this.productRepository.findAndCount({
      skip,
      take: limit,
      order: { productId: 'ASC' },
    });

    const data = items.map((product) => ({
      productId: product.productId,
      name: product.name,
      price: Number(product.price),
      availableStock: product.availableStock,
      remainingStock: product.remainingStock ?? product.availableStock,
      isFlashSaleActive: product.isFlashSaleActive,
    }));

    const totalPages = Math.ceil(total / limit);

    const responsePayload: PaginatedProductsResponse = {
      status: 'success',
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };

    // 3. Save to Redis Cache with TTL
    await this.redisService.set(
      cacheKey,
      JSON.stringify(responsePayload),
      this.CACHE_TTL_SECONDS,
    );

    return responsePayload;
  }

  async findAll(): Promise<Product[]> {
    return this.productRepository.find({
      order: { productId: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Product> {
    const cacheKey = `product:${id}`;

    // 1. Check Redis Cache (Cache-Aside)
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as Product;
      } catch (err: any) {
        this.logger.warn(`Failed to parse cache for product ${id}: ${err.message}`);
      }
    }

    // 2. Query Database on Cache MISS
    const product = await this.productRepository.findOne({
      where: { productId: id },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }

    // 3. Save to Redis Cache with TTL
    await this.redisService.set(
      cacheKey,
      JSON.stringify(product),
      this.CACHE_TTL_SECONDS,
    );

    return product;
  }
}

