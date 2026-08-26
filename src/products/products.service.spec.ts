import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return all products', () => {
    const products = service.findAll();
    expect(Array.isArray(products)).toBe(true);
    expect(products.length).toBeGreaterThan(0);
  });

  it('should return a product by ID if found', () => {
    const product = service.findOne('p-1001');
    expect(product).toBeDefined();
    expect(product.productId).toBe('p-1001');
  });

  it('should throw NotFoundException if product is not found', () => {
    expect(() => service.findOne('non-existent-id')).toThrow();
  });
});
