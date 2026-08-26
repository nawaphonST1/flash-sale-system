import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn().mockResolvedValue({
              access_token: 'mock_jwt_token',
              token_type: 'Bearer',
              expires_in: '1h',
              user: {
                userId: 'user_123',
                username: 'tester',
                role: 'customer',
              },
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call authService.login when /token is called', async () => {
    const dto = { username: 'tester', password: 'password123' };
    const response = await controller.issueToken(dto);

    expect(service.login).toHaveBeenCalledWith(dto);
    expect(response).toHaveProperty('access_token', 'mock_jwt_token');
  });

  it('should return profile payload from current user', () => {
    const mockUser = { userId: 'user_123', username: 'tester', role: 'customer' };
    const result = controller.getProfile(mockUser);

    expect(result).toHaveProperty('user', mockUser);
    expect(result).toHaveProperty('message', 'Access granted to protected resource');
  });
});
