import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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
