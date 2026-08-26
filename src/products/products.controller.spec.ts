import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('ProductsController', () => {
  let controller: ProductsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [ProductsService],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return all products', () => {
    const result = controller.findAll();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should return a product by ID', () => {
    const result = controller.findOne('p-1001');
    expect(result.productId).toBe('p-1001');
  });
});
