import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric('http_requests_total')
    private readonly requestCounter: Counter<string>,
    @InjectMetric('http_request_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    const startTime = process.hrtime();
    const method = req.method;

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(req, res, method, startTime);
        },
        error: (err) => {
          const status = err.status || (err.getStatus ? err.getStatus() : 500);
          this.recordMetrics(req, { statusCode: status }, method, startTime);
        },
      }),
    );
  }

  private recordMetrics(req: any, res: any, method: string, startTime: [number, number]): void {
    const diff = process.hrtime(startTime);
    const durationSeconds = diff[0] + diff[1] / 1e9;
    const statusCode = String(res.statusCode || 200);

    const route = req.route?.path || req.baseUrl || req.path || 'unknown';

    // Ignore scraping endpoint from metrics observation to prevent noise
    if (route === '/metrics') {
      return;
    }

    this.requestCounter.inc({
      method,
      route,
      status_code: statusCode,
    });

    this.durationHistogram.observe(
      {
        method,
        route,
        status_code: statusCode,
      },
      durationSeconds,
    );
  }
}
