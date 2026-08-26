import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

const mockProduct: Product = {
  productId: 'p-1001',
  name: 'Limited Edition Sneaker',
  description: 'รองเท้ารุ่นลิมิเต็ด',
  price: 2990,
  availableStock: 50,
  isFlashSaleActive: true,
};

describe('ProductsService', () => {
  let service: ProductsService;
  let mockRepository: any;

  beforeEach(async () => {
    mockRepository = {
      count: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockResolvedValue([mockProduct]),
      findOne: jest.fn().mockImplementation(({ where: { productId } }) => {
        if (productId === 'p-1001') return Promise.resolve(mockProduct);
        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue([mockProduct]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
