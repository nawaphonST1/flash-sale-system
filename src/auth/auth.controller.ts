import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import * as os from 'os';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly instanceId = process.env.INSTANCE_ID || os.hostname();

  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/v1/auth/token
   * จำลองการ Login เพื่อออก JSON Web Token (JWT) ให้กับผู้ใช้งาน
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async issueToken(@Body() loginDto: LoginDto) {
    const userIdentifier = loginDto.username || loginDto.userId;
    this.logger.log(
      `⚡ [${this.instanceId}] Received POST /api/v1/auth/token for user: ${userIdentifier}`,
    );
    return this.authService.login(loginDto);
  }

  /**
   * POST /api/v1/auth/login (Alias สำหรับ /token)
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    const userIdentifier = loginDto.username || loginDto.userId;
    this.logger.log(
      `⚡ [${this.instanceId}] Received POST /api/v1/auth/login for user: ${userIdentifier}`,
    );
    return this.authService.login(loginDto);
  }

  /**
   * GET /api/v1/auth/profile
   * Protected Route สำหรับทดสอบ JwtAuthGuard
   */
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentUser() user: any) {
    return {
      message: 'Access granted to protected resource',
      user,
    };
  }
}
