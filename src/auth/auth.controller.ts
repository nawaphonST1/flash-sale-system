import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GenerateTokenDto } from './dto/generate-token.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  generateToken(@Body() dto: GenerateTokenDto) {
    return this.authService.generateToken(dto);
  }
}
