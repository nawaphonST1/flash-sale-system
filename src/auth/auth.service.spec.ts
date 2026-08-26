import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('mock_jwt_token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => defaultValue || '1h'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate token successfully for valid payload', async () => {
    const result = await service.login({
      username: 'tester',
      password: 'password123',
      role: 'customer',
    });

    expect(result).toHaveProperty('access_token', 'mock_jwt_token');
    expect(result).toHaveProperty('token_type', 'Bearer');
    expect(result.user).toHaveProperty('username', 'tester');
    expect(result.user).toHaveProperty('role', 'customer');
  });
});
