import { Controller, Get, Param, Query } from '@nestjs/common';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { Product } from './entities/product.entity';
import { PaginatedProductsResponse, ProductsService } from './products.service';

@Controller('api/v1/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(@Query() query: PaginationQueryDto): Promise<PaginatedProductsResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    return this.productsService.findAllPaginated(page, limit);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Product> {
    return this.productsService.findOne(id);
  }
}

