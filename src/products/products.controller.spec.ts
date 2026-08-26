import { Test, TestingModule } from '@nestjs/testing';
import { Product } from './entities/product.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

const mockProduct: Product = {
  productId: 'p-1001',
  name: 'Limited Edition Sneaker',
  description: 'รองเท้ารุ่นลิมิเต็ด',
  price: 2990,
  availableStock: 50,
  isFlashSaleActive: true,
};

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: ProductsService;

  beforeEach(async () => {
    const mockProductsService = {
      findAll: jest.fn().mockResolvedValue([mockProduct]),
      findOne: jest.fn().mockResolvedValue(mockProduct),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return all products', async () => {
    const result = await controller.findAll();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it('should return a product by ID', async () => {
    const result = await controller.findOne('p-1001');
    expect(result.productId).toBe('p-1001');
  });
});
