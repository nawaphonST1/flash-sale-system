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
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        replication: {
          master: {
            host: configService.get<string>('DB_HOST', 'localhost'),
            port: Number(configService.get<number>('DB_PORT', 5433)),
            username: configService.get<string>('DB_USERNAME', 'postgres'),
            password: configService.get<string>('DB_PASSWORD', 'postgrespassword'),
            database: configService.get<string>('DB_NAME', 'flash_sale_db'),
          },
          slaves: [
            {
              host: configService.get<string>(
                'DB_REPLICA_HOST',
                configService.get<string>('DB_HOST', 'localhost'),
              ),
              port: Number(
                configService.get<number>(
                  'DB_REPLICA_PORT',
                  configService.get<number>('DB_PORT', 5433),
                ),
              ),
              username: configService.get<string>(
                'DB_REPLICA_USERNAME',
                configService.get<string>('DB_USERNAME', 'postgres'),
              ),
              password: configService.get<string>(
                'DB_REPLICA_PASSWORD',
                configService.get<string>('DB_PASSWORD', 'postgrespassword'),
              ),
              database: configService.get<string>(
                'DB_REPLICA_NAME',
                configService.get<string>('DB_NAME', 'flash_sale_db'),
              ),
            },
          ],
        },
        entities: [Product, Order],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        migrationsRun: true, // Auto-run migrations on startup
        synchronize: false, // Safe for multi-instance and production
        // Database Connection Pooling Options (Prevents Connection Exhaustion)
        extra: {
          max: 10, // Max connections per backend instance (3 instances = 30 max connections)
          min: 2, // Keep 2 minimum connections alive
          idleTimeoutMillis: 30000, // Close idle connections after 30s
          connectionTimeoutMillis: 5000, // Connection timeout after 5s
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

    RedisModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
