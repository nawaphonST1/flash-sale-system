import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BullBoardService } from './bull-board.module';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    logger: isProduction ? ['warn', 'error'] : ['log', 'warn', 'error'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const bullBoardService = app.get(BullBoardService);
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin';

  app.use('/admin/queues', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="BullBoard Admin"');
      return res.status(401).send('Authentication required');
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [username, password] = credentials.split(':');

    if (username === adminUser && password === adminPass) {
      return next();
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="BullBoard Admin"');
    return res.status(401).send('Invalid credentials');
  }, bullBoardService.getRouter());
  const port = process.env.PORT ?? 3000;
  const server = await app.listen(port, '0.0.0.0');
  if (server && typeof server === 'object' && 'keepAliveTimeout' in server) {
    server.keepAliveTimeout = 75000;
    server.headersTimeout = 76000;
    server.maxHeadersCount = 2000;
  }
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
