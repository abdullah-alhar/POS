import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const TEST_DB = 'postgresql://pos:pos@localhost:5432/marina_pos_test';

export default defineConfig({
  // SWC keeps decorator metadata, which NestJS needs for dependency injection.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // All integration tests share one database, so run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? TEST_DB,
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      WEB_DIST_DIR: '/nonexistent',
      STORAGE_DIR: './storage-test',
    },
  },
});
