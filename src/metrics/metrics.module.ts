import { Global, Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { MetricsInterceptor } from './metrics.interceptor';

export const metricsProviders = [
  makeCounterProvider({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests processed',
    labelNames: ['method', 'route', 'status_code'],
  }),
  makeHistogramProvider({
    name: 'http_request_duration_seconds',
    help: 'Histogram of HTTP request durations in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),
  makeCounterProvider({
    name: 'flash_sale_orders_total',
    help: 'Total flash sale order requests categorized by status',
    labelNames: ['status'],
  }),
  makeCounterProvider({
    name: 'flash_sale_queue_jobs_total',
    help: 'Total queue jobs processed in Flash Sale system',
    labelNames: ['queue', 'status'],
  }),
  makeGaugeProvider({
    name: 'flash_sale_stock_level',
    help: 'Current stock level of flash sale product in Redis cache',
    labelNames: ['product_id'],
  }),
];

@Global()
@Module({
  providers: [...metricsProviders, MetricsInterceptor],
  exports: [...metricsProviders, MetricsInterceptor],
})
export class MetricsModule {}
