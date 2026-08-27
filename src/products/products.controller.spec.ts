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
  remainingStock: 30,
  isFlashSaleActive: true,
};

const mockPaginatedResponse = {
  status: 'success',
  data: [
    {
      productId: 'p-1001',
      name: 'Limited Edition Sneaker',
      price: 2990,
      availableStock: 50,
      remainingStock: 30,
      isFlashSaleActive: true,
    },
  ],
  meta: {
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
  },
};

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: ProductsService;

  beforeEach(async () => {
    const mockProductsService = {
      findAllPaginated: jest.fn().mockResolvedValue(mockPaginatedResponse),
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

  it('should return paginated products', async () => {
    const result = await controller.findAll({ page: 1, limit: 10 });
    expect(result.status).toBe('success');
    expect(result.data.length).toBe(1);
    expect(result.meta.page).toBe(1);
  });

  it('should return a product by ID', async () => {
    const result = await controller.findOne('p-1001');
    expect(result.productId).toBe('p-1001');
  });
});

