import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import DbFirstSequencer from './test/sequencer';

const shared = fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@cms/shared': shared } },
  test: {
    sequence: { sequencer: DbFirstSequencer },
    // `unit` needs no DB. `integration` (files named *.int.test.ts) runs only when TEST_DATABASE_URL is set,
    // so `npm test` still passes without a database; CI and `/spec-check` always set it.
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
      ...(process.env.TEST_DATABASE_URL ? [{
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
      }] : []),
    ],
  },
});
