import { execSync } from 'node:child_process';

/** Resets the disposable test Postgres once per run (docs/implementation/00 §2.5). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required for integration tests (e.g. a Docker postgres:15).');
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
