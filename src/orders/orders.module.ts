import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersProcessor } from './orders.processor';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Product]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersProcessor],
  exports: [OrdersService, OrdersProcessor],
})
export class OrdersModule {}
