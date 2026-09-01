import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async reset() {
    return this.adminService.resetSystem();
  }
}
