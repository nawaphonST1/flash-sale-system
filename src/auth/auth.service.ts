import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GenerateTokenDto } from './dto/generate-token.dto';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  generateToken(dto: GenerateTokenDto) {
    const payload = {
      userId: dto.userId,
      username: dto.username ?? `user_${dto.userId}`,
      role: dto.role ?? 'CUSTOMER',
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      user: payload,
    };
  }
}
