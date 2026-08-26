import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import * as productsSeedData from './products-seed.json';

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
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
      ) as Product[];

      if (rawData.length > 0) {
        const entities = this.productRepository.create(rawData);
        await this.productRepository.save(entities);
        this.logger.log(`Successfully seeded ${entities.length} products to database.`);
      }
    }
  }

  async findAll(): Promise<Product[]> {
    return this.productRepository.find({
      order: { productId: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { productId: id },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }

    return product;
  }
}
