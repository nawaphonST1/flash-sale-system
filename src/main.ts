import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { BullBoardService } from './bull-board.module';

async function bootstrap() {
  const isWorker = process.env.ROLE === 'worker';

  if (isWorker) {
    // Worker only mode (No HTTP server required)
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    console.log(`[Worker Process] Background Queue Worker started with role: worker`);
    return;
  }

  // API HTTP Server mode with Fastify
  const adapter = new FastifyAdapter({
    logger: false,
    keepAliveTimeout: 75000,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      logger: ['warn', 'error'],
      rawBody: true,
    },
  );

  const fastify = app.getHttpAdapter().getInstance();

  // Fastify Hook: Handle empty body when Content-Type is application/json (e.g. reset script)
  fastify.addHook('preParsing', (req: any, reply: any, payload: any, done: any) => {
    const contentType = req.headers['content-type'] || '';
    const contentLength = req.headers['content-length'];
    if (
      contentType.includes('application/json') &&
      (contentLength === '0' || contentLength === undefined)
    ) {
      req.headers['content-type'] = 'text/plain';
    }
    done(null, payload);
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Register BullBoard for admin UI
  try {
    const bullBoardService = app.get(BullBoardService);
    const serverAdapter = bullBoardService.getServerAdapter();
    const fastifyInstance = app.getHttpAdapter().getInstance();
    serverAdapter.setBasePath('/admin/queues');
    fastifyInstance.register(serverAdapter.registerPlugin(), { prefix: '/admin/queues' } as any);
  } catch (err: any) {
    console.warn(`BullBoard registration note: ${err.message}`);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`[API Process] High-Performance Fastify Server is running on: http://0.0.0.0:${port}`);
}
bootstrap();
