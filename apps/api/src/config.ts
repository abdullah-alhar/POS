import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** 127.0.0.1 = only this laptop. Use 0.0.0.0 to allow other devices on the shop network. */
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is missing'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Folder with the built web app (apps/web/dist). */
  WEB_DIST_DIR: z.string().optional(),
  STORAGE_DIR: z.string().default('./storage'),
  /**
   * HTTPS: folder with the local certificate authority and the server certificate (see cli/tls.ts).
   * When set, PORT is the HTTPS port (443) and HTTP_PORT (80) only redirects to HTTPS.
   */
  TLS_DIR: z.string().optional(),
  TLS_HOST: z.string().default('pos.shop'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /** Force secure cookies. Automatically on when TLS_DIR is set. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    webDistDir: path.resolve(env.WEB_DIST_DIR ?? path.join(__dirname, '..', '..', 'web', 'dist')),
    storageDir: path.resolve(env.STORAGE_DIR),
    tlsDir: env.TLS_DIR ? path.resolve(env.TLS_DIR) : null,
    tlsHost: env.TLS_HOST,
    httpRedirectPort: env.HTTP_PORT ?? null,
    cookieSecure: env.COOKIE_SECURE || !!env.TLS_DIR,
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;

let cached: AppConfig | undefined;

export function config(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Tests change env between runs. */
export function resetConfigCache() {
  cached = undefined;
}
