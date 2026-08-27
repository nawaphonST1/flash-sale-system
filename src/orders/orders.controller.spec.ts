import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: OrdersService;

  beforeEach(async () => {
    const mockOrdersService = {
      createOrder: jest.fn().mockResolvedValue({
        status: 'PENDING',
        orderJobId: 'job_123',
        message: 'Order request accepted and queued for processing',
      }),
      getOrderStatus: jest.fn().mockResolvedValue({
        orderJobId: 'job_123',
        status: 'CONFIRMED',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create order and return 202 payload', async () => {
    const result = await controller.createOrder('user-001', {
      productId: 'p-1001',
    });

    expect(service.createOrder).toHaveBeenCalledWith('user-001', {
      productId: 'p-1001',
    });
    expect(result.status).toBe('PENDING');
    expect(result.orderJobId).toBe('job_123');
  });

  it('should pass idempotency key to service when provided', async () => {
    const result = await controller.createOrder(
      'user-001',
      { productId: 'p-1001' },
      'idem-key-123',
    );

    expect(service.createOrder).toHaveBeenCalledWith(
      'user-001',
      { productId: 'p-1001' },
      'idem-key-123',
    );
    expect(result.status).toBe('PENDING');
  });

  it('should get order status', async () => {
    const result = await controller.getOrderStatus('job_123');

    expect(service.getOrderStatus).toHaveBeenCalledWith('job_123');
    expect(result.status).toBe('CONFIRMED');
  });
});
