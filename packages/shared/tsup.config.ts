import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  // In watch mode keep the old files until the new ones are written, so the API never
  // sees a missing package while both start together.
  clean: !options.watch,
  sourcemap: true,
}));
