import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { OrdersModule } from './orders/orders.module';
import { OrdersService } from './orders/orders.service';

@Injectable()
export class BullBoardService implements OnModuleInit {
  private serverAdapter: ExpressAdapter;

  constructor(private readonly ordersService: OrdersService) {
    this.serverAdapter = new ExpressAdapter();
    this.serverAdapter.setBasePath('/admin/queues');
  }

  onModuleInit() {
    const queueLanes = this.ordersService.getQueueLanes();
    createBullBoard({
      queues: queueLanes.map((queue) => new BullMQAdapter(queue)),
      serverAdapter: this.serverAdapter,
    });
  }

  getRouter() {
    return this.serverAdapter.getRouter();
  }
}

@Module({
  imports: [OrdersModule],
  providers: [BullBoardService],
  exports: [BullBoardService],
})
export class BullBoardModule {}
