import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

@Controller('api/v1/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(
    @Query() query: PaginationQueryDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const jsonString = await this.productsService.findAllPaginatedRaw(page, limit);
    reply.header('Content-Type', 'application/json; charset=utf-8').send(jsonString);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Product> {
    return this.productsService.findOne(id);
  }
}

