import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  let mockRequestCounter: any;
  let mockDurationHistogram: any;

  beforeEach(() => {
    mockRequestCounter = {
      inc: jest.fn(),
    };
    mockDurationHistogram = {
      observe: jest.fn(),
    };
    interceptor = new MetricsInterceptor(
      mockRequestCounter,
      mockDurationHistogram,
    );
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should record metrics on successful HTTP request', (done) => {
    const mockRequest = {
      method: 'GET',
      route: { path: '/api/v1/products' },
      path: '/api/v1/products',
    };
    const mockResponse = {
      statusCode: 200,
    };

    const mockExecutionContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => of({ success: true }),
    };

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
      next: () => {
        expect(mockRequestCounter.inc).toHaveBeenCalledWith({
          method: 'GET',
          route: '/api/v1/products',
          status_code: '200',
        });
        expect(mockDurationHistogram.observe).toHaveBeenCalled();
        done();
      },
    });
  });

  it('should record metrics with error status code on failed HTTP request', (done) => {
    const mockRequest = {
      method: 'POST',
      route: { path: '/api/v1/orders' },
      path: '/api/v1/orders',
    };
    const mockResponse = {
      statusCode: 409,
    };

    const mockExecutionContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => throwError(() => ({ status: 409, message: 'Conflict' })),
    };

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
      error: () => {
        expect(mockRequestCounter.inc).toHaveBeenCalledWith({
          method: 'POST',
          route: '/api/v1/orders',
          status_code: '409',
        });
        expect(mockDurationHistogram.observe).toHaveBeenCalled();
        done();
      },
    });
  });

  it('should not record metrics for /metrics scrape endpoint', (done) => {
    const mockRequest = {
      method: 'GET',
      route: { path: '/metrics' },
      path: '/metrics',
    };
    const mockResponse = {
      statusCode: 200,
    };

    const mockExecutionContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => of('metrics_data'),
    };

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
      next: () => {
        expect(mockRequestCounter.inc).not.toHaveBeenCalled();
        expect(mockDurationHistogram.observe).not.toHaveBeenCalled();
        done();
      },
    });
  });
});
