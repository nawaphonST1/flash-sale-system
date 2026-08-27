import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RedisService } from '../redis/redis.service';
import { Product } from './entities/product.entity';
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

describe('ProductsService', () => {
  let service: ProductsService;
  let mockRepository: any;
  let mockRedisService: any;

  beforeEach(async () => {
    mockRepository = {
      count: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockResolvedValue([mockProduct]),
      findAndCount: jest.fn().mockResolvedValue([[mockProduct], 1]),
      findOne: jest.fn().mockImplementation(({ where: { productId } }) => {
        if (productId === 'p-1001') return Promise.resolve(mockProduct);
        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue([mockProduct]),
    };

    mockRedisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: mockRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return paginated products on cache miss and store to redis', async () => {
    const result = await service.findAllPaginated(1, 10);
    expect(result.status).toBe('success');
    expect(result.data.length).toBe(1);
    expect(result.meta.total).toBe(1);
    expect(mockRedisService.get).toHaveBeenCalledWith('products:page:1:limit:10');
    expect(mockRedisService.set).toHaveBeenCalled();
  });

  it('should return cached products on cache hit without querying database', async () => {
    const cachedData = {
      status: 'success',
      data: [mockProduct],
      meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
    };
    mockRedisService.get.mockResolvedValueOnce(JSON.stringify(cachedData));

    const result = await service.findAllPaginated(1, 10);
    expect(result.status).toBe('success');
    expect(mockRepository.findAndCount).not.toHaveBeenCalled();
  });

  it('should return all products', async () => {
    const products = await service.findAll();
    expect(Array.isArray(products)).toBe(true);
    expect(products.length).toBe(1);
    expect(products[0].productId).toBe('p-1001');
  });

  it('should return a product by ID if found', async () => {
    const product = await service.findOne('p-1001');
    expect(product).toBeDefined();
    expect(product.productId).toBe('p-1001');
  });

  it('should throw NotFoundException if product is not found', async () => {
    await expect(service.findOne('non-existent-id')).rejects.toThrow(
      NotFoundException,
    );
  });
});

