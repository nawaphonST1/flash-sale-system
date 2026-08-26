import { Injectable, NotFoundException } from '@nestjs/common';
import { Product } from './entities/product.entity';
import * as productsSeedData from './products-seed.json';

@Injectable()
export class ProductsService {
  private readonly products: Product[] = (
    Array.isArray(productsSeedData) ? productsSeedData : (productsSeedData as any).default || []
  ) as Product[];

  findAll(): Product[] {
    return this.products;
  }

  findOne(id: string): Product {
    const product = this.products.find((p) => p.productId === id);
    if (!product) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }
    return product;
  }
}
