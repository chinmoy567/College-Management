import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const shared = fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@cms/shared': shared } },
  test: {
    // `unit` needs no DB. `integration` (files named *.int.test.ts) needs TEST_DATABASE_URL.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['e2e/**', '**/*.int.test.ts', '**/node_modules/**', '**/dist/**'],
          env: { NODE_ENV: 'test' },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/**/*.int.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          globalSetup: ['./test/globalSetup.ts'],
          fileParallelism: false,
          env: { NODE_ENV: 'test' },
        },
      },
    ],
  },
});
