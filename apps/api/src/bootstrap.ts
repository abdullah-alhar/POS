import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { maintenance } from './modules/backups/backups.service';

/** Shared by main.ts and the integration tests, so tests run the real app setup. */
export async function createApp(
  options: { logger?: false; httpsOptions?: { key: Buffer; cert: Buffer } } = {},
) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: options.logger,
    bodyParser: false,
    httpsOptions: options.httpsOptions,
  });
  app.useBodyParser('json', { limit: '2mb' });
  app.use(cookieParser());
  // While a backup is restored, everything else waits (the health check keeps answering).
  app.use(
    (
      req: { path: string },
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void,
    ) => {
      if (maintenance.restoring && req.path.startsWith('/api/') && req.path !== '/api/health') {
        res.status(503).json({
          statusCode: 503,
          code: 'MAINTENANCE',
          message: 'A backup is being restored. Please wait a minute.',
        });
        return;
      }
      next();
    },
  );
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
