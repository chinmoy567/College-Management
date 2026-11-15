import 'dotenv/config';
import { defineConfig } from '@playwright/test';

// The e2e specs create sessions, users and more through the API. They must never run against the dev
// database (they used to leave ~90 junk sessions in it), so point app and specs at the local test database.
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error('TEST_DATABASE_URL is required for e2e tests (local Postgres, never the dev/Supabase database).');
process.env.DATABASE_URL = testDb;
process.env.DIRECT_URL = testDb;

const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: 'phone', use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  // Starts the app against the test DB (demo seed added in M1).
  webServer: {
    command: 'npm run build:shared && npx prisma migrate deploy && npm run start:e2e -w @cms/api',
    url: `http://localhost:${port}/api/health`,
    env: { DATABASE_URL: testDb, DIRECT_URL: testDb, PORT: String(port), E2E_FAKE_AI: '1', E2E_MEMORY_STORAGE: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
