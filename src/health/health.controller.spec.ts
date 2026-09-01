import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis.health';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;
  let typeOrmIndicator: TypeOrmHealthIndicator;
  let redisIndicator: RedisHealthIndicator;
  let memoryIndicator: MemoryHealthIndicator;

  const mockCheckResult: HealthCheckResult = {
    status: 'ok',
    info: {
      database: { status: 'up' },
      redis: { status: 'up', latencyMs: 1 },
      memory_heap: { status: 'up' },
      memory_rss: { status: 'up' },
    },
    error: {},
    details: {
      database: { status: 'up' },
      redis: { status: 'up', latencyMs: 1 },
      memory_heap: { status: 'up' },
      memory_rss: { status: 'up' },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn().mockImplementation(async (indicators) => {
              for (const indicator of indicators) {
                await indicator();
              }
              return mockCheckResult;
            }),
          },
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: {
            pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
          },
        },
        {
          provide: RedisHealthIndicator,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue({ redis: { status: 'up', latencyMs: 1 } }),
          },
        },
        {
          provide: MemoryHealthIndicator,
          useValue: {
            checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
            checkRSS: jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } }),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
    typeOrmIndicator = module.get<TypeOrmHealthIndicator>(TypeOrmHealthIndicator);
    redisIndicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
    memoryIndicator = module.get<MemoryHealthIndicator>(MemoryHealthIndicator);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check (/health)', () => {
    it('should return combined deep health status', async () => {
      const result = await controller.check();
      expect(result.status).toBe('ok');
      expect(result).toHaveProperty('instanceId');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('timestamp');
      expect(typeOrmIndicator.pingCheck).toHaveBeenCalled();
      expect(redisIndicator.isHealthy).toHaveBeenCalled();
      expect(memoryIndicator.checkHeap).toHaveBeenCalled();
      expect(memoryIndicator.checkRSS).toHaveBeenCalled();
    });
  });

  describe('getLiveness (/health/liveness)', () => {
    it('should return liveness status ok', () => {
      const result = controller.getLiveness();
      expect(result.status).toBe('ok');
      expect(result).toHaveProperty('instanceId');
      expect(result).toHaveProperty('uptime');
    });
  });

  describe('getReadiness (/health/readiness)', () => {
    it('should return readiness check result for DB and Redis', async () => {
      const result = await controller.getReadiness();
      expect(result.status).toBe('ok');
      expect(typeOrmIndicator.pingCheck).toHaveBeenCalled();
      expect(redisIndicator.isHealthy).toHaveBeenCalled();
    });
  });
});
