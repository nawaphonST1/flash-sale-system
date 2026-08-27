import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * POST /api/v1/orders
   * Receives order request, validates JWT, checks Idempotency Key & Redis atomic lock,
   * enqueues job into BullMQ, and returns 202 Accepted immediately.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async createOrder(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
    @Headers('x-idempotency-key') xIdempotencyKeyHeader?: string,
  ) {
    const idempotencyKey = idempotencyKeyHeader || xIdempotencyKeyHeader;
    if (idempotencyKey) {
      return this.ordersService.createOrder(userId, dto, idempotencyKey);
    }
    return this.ordersService.createOrder(userId, dto);
  }

  /**
   * GET /api/v1/orders/status/:jobId
   * Checks processing status of an order job
   */
  @Get('status/:jobId')
  @UseGuards(JwtAuthGuard)
  async getOrderStatus(@Param('jobId') jobId: string) {
    return this.ordersService.getOrderStatus(jobId);
  }
}
