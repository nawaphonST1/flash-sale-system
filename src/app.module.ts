import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Prometheus Metrics Provider
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
      },
    }),

    // PostgreSQL TypeORM Configuration with Master/Replica Replication
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
          max: 50, // 50 connections per instance (3 instances = 150 total connections)
          min: 5,  // Keep 5 warm connections per instance
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
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
    AuthModule,
    ProductsModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
