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
          await this.buildAndCachePageTemplate(page, cfg.limit);
        }
      }
      this.logger.log('Pagination template cache pre-warmed in Redis.');
    } catch (err: any) {
      this.logger.warn(`Failed to pre-warm pagination cache: ${err.message}`);
    }
  }

  private async buildAndCachePageTemplate(pageNum: number, limitNum: number): Promise<{ template: string; productIds: string[] }> {
    const skip = (pageNum - 1) * limitNum;
    const [items, total] = await this.productRepository.findAndCount({
      skip,
      take: limitNum,
      order: { productId: 'ASC' },
    });

    const totalPages = Math.ceil(total / limitNum);
    const productIds = items.map((p) => p.productId);

    // Build template string with placeholders @@RS_<productId>@@
    const itemsJsonTemplates = items.map((product) => {
      return `{"productId":"${product.productId}","name":${JSON.stringify(product.name)},"price":${Number(product.price)},"availableStock":${Number(product.availableStock)},"remainingStock":@@RS_${product.productId}@@,"isFlashSaleActive":${Boolean(product.isFlashSaleActive)}}`;
    });

    const template = `{"status":"success","data":[${itemsJsonTemplates.join(',')}],"meta":{"total":${Number(total)},"page":${pageNum},"limit":${limitNum},"totalPages":${Number(totalPages)}}}`;

    const templateKey = `products:tmpl:${pageNum}:${limitNum}`;
    const keysKey = `products:keys:${pageNum}:${limitNum}`;

    await this.redisService.set(templateKey, template, this.CACHE_TTL_SECONDS);
    await this.redisService.set(keysKey, JSON.stringify(productIds), this.CACHE_TTL_SECONDS);

    return { template, productIds };
  }

  async findAllPaginatedRaw(page: number = 1, limit: number = 10): Promise<string> {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const templateKey = `products:tmpl:${pageNum}:${limitNum}`;
    const keysKey = `products:keys:${pageNum}:${limitNum}`;

    let template = await this.redisService.get(templateKey);
    let productIdsRaw = await this.redisService.get(keysKey);
    let productIds: string[] = [];

    if (!template || !productIdsRaw) {
      // Rebuild template and cache in Redis
      const built = await this.buildAndCachePageTemplate(pageNum, limitNum);
      template = built.template;
      productIds = built.productIds;
    } else {
      try {
        productIds = JSON.parse(productIdsRaw);
      } catch (_) {
        productIds = [];
      }
    }

    if (!template) {
      return JSON.stringify({ status: 'success', data: [], meta: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
    }

    // Fast MGET for live stock from Redis
    if (productIds.length > 0) {
      const stockKeys = productIds.map((id) => `stock:${id}`);
      const liveStocks = await this.redisService.getClient().mget(...stockKeys);

      // Splice template string with live stocks
      let result = template;
      for (let i = 0; i < productIds.length; i++) {
        const id = productIds[i];
        const stockVal = liveStocks[i] ?? '0';
        result = result.replace(`@@RS_${id}@@`, stockVal);
      }
      return result;
    }

    return template;
  }

  async findAllPaginated(page: number = 1, limit: number = 10): Promise<any> {
    const rawJson = await this.findAllPaginatedRaw(page, limit);
    return JSON.parse(rawJson);
  }

  async findAll(): Promise<Product[]> {
    return this.productRepository.find({
      order: { productId: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Product> {
    const cacheKey = `product:${id}`;

    // 1. Check Redis Cache
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        const product = JSON.parse(cached) as Product;
        const liveStock = await this.redisService.get(`stock:${id}`);
        if (liveStock !== null) {
          product.remainingStock = Number(liveStock);
        }
        return product;
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

    const liveStock = await this.redisService.get(`stock:${id}`);
    if (liveStock !== null) {
      product.remainingStock = Number(liveStock);
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

