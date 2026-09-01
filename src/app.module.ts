import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { Order } from './orders/entities/order.entity';
import { OrdersModule } from './orders/orders.module';
import { Product } from './products/entities/product.entity';
import { ProductsModule } from './products/products.module';
import { RedisModule } from './redis/redis.module';
import { AdminModule } from './admin/admin.module';
import { BullBoardModule } from './bull-board.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsInterceptor } from './metrics/metrics.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Prometheus Metrics Provider (/metrics)
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
      },
    }),

    // PostgreSQL Master Database Configuration
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: Number(configService.get<number>('DB_PORT', 5433)),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgrespassword'),
        database: configService.get<string>('DB_NAME', 'flash_sale_db'),
        entities: [Product, Order],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        migrationsRun: true, // Auto-run migrations on startup
        synchronize: false, // Safe for multi-instance and production
        // High Performance Connection Pooling
        extra: {
          max: 30, // 30 connections per instance (6 instances = 180 total connections)
          min: 5,  // Keep 5 warm connections per instance
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        },
      }),
    }),

    // BullMQ Queue Configuration with Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: Number(configService.get<number>('REDIS_PORT', 6379)),
          maxRetriesPerRequest: null,
        },
      }),
    }),

    TypeOrmModule.forFeature([Product, Order]),

    RedisModule,
    AdminModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
    BullBoardModule,
    HealthModule,
    MetricsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule {}
