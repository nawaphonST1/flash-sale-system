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
            generateToken: jest.fn().mockReturnValue({
              accessToken: 'mock_jwt_token',
              tokenType: 'Bearer',
              user: {
                userId: 'user-001',
                username: 'tester',
                role: 'CUSTOMER',
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

  it('should call authService.generateToken when /token is called', () => {
    const dto = { userId: 'user-001', username: 'tester' };
    const response = controller.generateToken(dto);

    expect(service.generateToken).toHaveBeenCalledWith(dto);
    expect(response).toHaveProperty('accessToken', 'mock_jwt_token');
    expect(response).toHaveProperty('tokenType', 'Bearer');
  });
});
