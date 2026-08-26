import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const mockJwtService = {
      sign: jest.fn().mockReturnValue('mocked.jwt.token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate a JWT token', () => {
    const result = service.generateToken({ userId: 'user-001', username: 'john_doe' });
    expect(result).toBeDefined();
    expect(result.accessToken).toBe('mocked.jwt.token');
    expect(result.tokenType).toBe('Bearer');
    expect(result.user.userId).toBe('user-001');
  });
});
