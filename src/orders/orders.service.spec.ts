import { getQueueToken } from '@nestjs/bullmq';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../redis/redis.service';
import { ORDER_QUEUE_NAME, OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockQueue: any;
  let mockRedisService: any;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: jest.fn().mockResolvedValue(null),
    };

    mockRedisService = {
      acquireUserProductLock: jest.fn().mockResolvedValue(true),
      releaseUserProductLock: jest.fn().mockResolvedValue(undefined),
      setJobStatus: jest.fn().mockResolvedValue(undefined),
      getJobStatus: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getQueueToken(ORDER_QUEUE_NAME),
          useValue: mockQueue,
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

  it('should acquire lock and push job to queue returning 202 payload', async () => {
    const result = await service.createOrder('user-1', { productId: 'p-1001' });

    expect(mockRedisService.acquireUserProductLock).toHaveBeenCalledWith('user-1', 'p-1001', 600);
    expect(mockQueue.add).toHaveBeenCalled();
    expect(result.status).toBe('PENDING');
    expect(result.orderJobId).toBeDefined();
  });

  it('should throw ConflictException if lock is already held', async () => {
    mockRedisService.acquireUserProductLock.mockResolvedValueOnce(false);

    await expect(
      service.createOrder('user-1', { productId: 'p-1001' }),
    ).rejects.toThrow(ConflictException);

    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
