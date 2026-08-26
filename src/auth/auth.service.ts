import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as os from 'os';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * จำลองการ Login และออก JSON Web Token (Stateless)
   */
  async login(loginDto: LoginDto) {
    const { username, userId, password, role } = loginDto;

    // จำลองการตรวจสอบ password ขั้นพื้นฐาน (สำหรับ mock login)
    if (!password || password.trim().length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const effectiveUsername = username || userId || 'user_guest';
    const effectiveUserId =
      userId || `user_${Buffer.from(effectiveUsername).toString('hex').slice(0, 8)}`;
    const userRole = role || 'customer';

    const payload: JwtPayload = {
      sub: effectiveUserId,
      username: effectiveUsername,
      role: userRole,
    };

    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '1h');
    const token = await this.jwtService.signAsync(payload as object);

    return {
      statusCode: 200,
      message: 'Authentication successful',
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      user: {
        userId: effectiveUserId,
        username: effectiveUsername,
        role: userRole,
      },
    };
  }
}
