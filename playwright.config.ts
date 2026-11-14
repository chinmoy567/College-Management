import { defineConfig } from '@playwright/test';

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
    command: 'npm run build:shared && npm run start:e2e -w @cms/api',
    url: `http://localhost:${port}/api/health`,
    env: { PORT: String(port), E2E_FAKE_AI: '1', E2E_MEMORY_STORAGE: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
