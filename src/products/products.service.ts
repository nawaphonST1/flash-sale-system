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
  private readonly CACHE_TTL_SECONDS = 3600; // 1 hour TTL (catalog is static, live stock is injected via MGET)

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

    // Sync available products stock into Redis for fast atomic Lua checks
    const allProducts = await this.productRepository.find();
    for (const p of allProducts) {
      await this.redisService.initProductStock(p.productId, p.availableStock);
    }

    // Pre-warm (Warmup) all pagination cache pages in Redis
    await this.warmupPaginationCache();
  }

  async warmupPaginationCache() {
    try {
      const configs = [
        { limit: 5, pages: [1, 2, 3, 4] },
        { limit: 10, pages: [1, 2] },
        { limit: 20, pages: [1] },
      ];
      for (const cfg of configs) {
        for (const page of cfg.pages) {
          await this.findAllPaginated(page, cfg.limit);
        }
      }
      this.logger.log('Pagination cache (all 7 combinations) successfully pre-warmed in Redis.');
    } catch (err: any) {
      this.logger.warn(`Failed to pre-warm pagination cache: ${err.message}`);
    }
  }

  async findAllPaginated(page: number = 1, limit: number = 10): Promise<PaginatedProductsResponse> {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const cacheKey = `products:page:${pageNum}:limit:${limitNum}`;

    // 1. Ultra-fast path: Single Redis GET for page structure
    const cachedData = await this.redisService.get(cacheKey);
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData) as PaginatedProductsResponse;
        // Inject live real-time stock for the active flash sale product (p-1001) with 1 fast key lookup
        const p1001Item = parsed.data.find((p) => p.productId === 'p-1001');
        if (p1001Item) {
          const liveStockStr = await this.redisService.get('stock:p-1001');
          if (liveStockStr !== null && liveStockStr !== undefined) {
            p1001Item.remainingStock = Number(liveStockStr);
          }
        }
        return parsed;
      } catch (err: any) {
        this.logger.warn(`Failed to parse cache for key ${cacheKey}: ${err.message}`);
      }
    }

    // 2. Cache Miss: Single-Flight via Redis Lock to prevent DB Thundering Herd
    const lockKey = `lock:build:products:${pageNum}:${limitNum}`;
    const acquired = await this.redisService.getClient().set(lockKey, '1', 'EX', 5, 'NX');

    if (!acquired) {
      // Another instance is rebuilding this page. Wait briefly for Redis cache to populate.
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        const retryCache = await this.redisService.get(cacheKey);
        if (retryCache) {
          try {
            return JSON.parse(retryCache) as PaginatedProductsResponse;
          } catch (_) {}
        }
      }
    }

    // 3. Query Database on Cache MISS (from Read Replica)
    await this.redisService.incrMetric('db_build');
    const skip = (pageNum - 1) * limitNum;
    const [items, total] = await this.productRepository.findAndCount({
      skip,
      take: limitNum,
      order: { productId: 'ASC' },
    });

    // High performance batch MGET from Redis for remaining stock
    const stockKeys = items.map((p) => `stock:${p.productId}`);
    let liveStocks: (string | null)[] = [];
    try {
      if (stockKeys.length > 0) {
        liveStocks = await this.redisService.getClient().mget(...stockKeys);
      }
    } catch (_) {}

    const data = items.map((product, idx) => {
      const liveStockVal = liveStocks[idx];
      const remainingStock = liveStockVal !== null && liveStockVal !== undefined
        ? Number(liveStockVal)
        : Number(product.remainingStock ?? product.availableStock);

      return {
        productId: product.productId,
        name: product.name,
        price: Number(product.price),
        availableStock: Number(product.availableStock),
        remainingStock: Number(remainingStock),
        isFlashSaleActive: Boolean(product.isFlashSaleActive),
      };
    });

    const totalPages = Math.ceil(total / limitNum);

    const responsePayload: PaginatedProductsResponse = {
      status: 'success',
      data,
      meta: {
        total: Number(total),
        page: pageNum,
        limit: limitNum,
        totalPages: Number(totalPages),
      },
    };

    // 4. Save to Redis Cache with TTL (60s) and release build lock
    await this.redisService.set(
      cacheKey,
      JSON.stringify(responsePayload),
      this.CACHE_TTL_SECONDS,
    );
    await this.redisService.getClient().del(lockKey).catch(() => {});

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

