import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { OrdersModule } from './orders/orders.module';
import { OrdersService } from './orders/orders.service';

@Injectable()
export class BullBoardService implements OnModuleInit {
  private serverAdapter: FastifyAdapter;

  constructor(private readonly ordersService: OrdersService) {
    this.serverAdapter = new FastifyAdapter();
    this.serverAdapter.setBasePath('/admin/queues');
  }

  onModuleInit() {
    const queueLanes = this.ordersService.getQueueLanes();
    createBullBoard({
      queues: queueLanes.map((queue) => new BullMQAdapter(queue)),
      serverAdapter: this.serverAdapter,
    });
  }

  getServerAdapter(): FastifyAdapter {
    return this.serverAdapter;
  }
}

@Module({
  imports: [OrdersModule],
  providers: [BullBoardService],
  exports: [BullBoardService],
})
export class BullBoardModule {}
