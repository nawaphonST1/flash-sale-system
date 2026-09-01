import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { RedisService } from '../redis/redis.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockRedisService: any;
  let mockProductRepo: any;

  beforeEach(async () => {
    mockRedisService = {
      getClient: jest.fn().mockReturnValue({}),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      claimFlashSaleOrder: jest.fn().mockResolvedValue(49),
      setJobStatus: jest.fn().mockResolvedValue(undefined),
      getJobStatus: jest.fn().mockResolvedValue(null),
      incrMetric: jest.fn().mockResolvedValue(1),
    };

    mockProductRepo = {
      findOne: jest.fn().mockResolvedValue({ productId: 'p-1001', availableStock: 50 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getRepositoryToken(Product),
          useValue: mockProductRepo,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should process order returning 202 processing status', async () => {
    // mock queueLanes
    (service as any).queueLanes = [
      { add: jest.fn().mockResolvedValue({ id: 'job-123' }), close: jest.fn() },
    ];

    const result = await service.createOrder('user-1', { productId: 'p-1001' });

    expect(mockRedisService.claimFlashSaleOrder).toHaveBeenCalledWith('user-1', 'p-1001', 600);
    expect(result.status).toBe('processing');
    expect(result.orderJobId).toBe('order:user-1:p-1001');
  });

  it('should throw ConflictException if duplicate order', async () => {
    mockRedisService.claimFlashSaleOrder.mockResolvedValueOnce(-3);

    await expect(
      service.createOrder('user-1', { productId: 'p-1001' }),
    ).rejects.toThrow(ConflictException);
  });

  it('should throw ConflictException if product sold out', async () => {
    mockRedisService.claimFlashSaleOrder.mockResolvedValueOnce(-1);

    await expect(
      service.createOrder('user-1', { productId: 'p-1001' }),
    ).rejects.toThrow(ConflictException);
  });
});
