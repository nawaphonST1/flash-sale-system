import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AuthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  let validToken = '';

  describe('POST /api/v1/auth/token', () => {
    it('should issue a valid JWT token when credentials are provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/token')
        .send({
          username: 'user_flash_01',
          password: 'secure_password_123',
          role: 'customer',
        })
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('token_type', 'Bearer');
      expect(response.body.user).toHaveProperty('username', 'user_flash_01');
      expect(response.body.user).toHaveProperty('role', 'customer');

      validToken = response.body.access_token;
    });

    it('should fail with 400 if username is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/token')
        .send({
          password: 'password123',
        })
        .expect(400);
    });

    it('should fail with 400 if password is empty', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/token')
        .send({
          username: 'user01',
          password: '',
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/auth/profile (Protected Route with JwtAuthGuard)', () => {
    it('should return 401 Unauthorized if no token is provided', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .expect(401);
    });

    it('should return 401 Unauthorized if invalid token is provided', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);
    });

    it('should return 200 OK and user payload when valid Bearer token is provided', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Access granted to protected resource');
      expect(response.body.user).toHaveProperty('username', 'user_flash_01');
      expect(response.body.user).toHaveProperty('role', 'customer');
    });
  });
});
