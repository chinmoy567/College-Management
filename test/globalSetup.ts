import { execSync } from 'node:child_process';
import pg from 'pg';

/**
 * Gives the integration tests a brand-new, empty database on the server in TEST_DATABASE_URL, applies every
 * migration to it (`prisma migrate deploy`), and drops it again afterwards. It never touches existing data
 * and never needs `migrate reset`, so a real database can not be wiped by pointing the URL at it by mistake.
 * Tests read DATABASE_URL / DIRECT_URL, which this setup points at the new database.
 */
let adminUrl = '';
let dbName = '';

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export default async function setup() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('TEST_DATABASE_URL is required for integration tests (e.g. a Docker postgres:15).');
  adminUrl = withDb(base, 'postgres');
  dbName = `cms_it_${process.pid}_${Date.now()}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const url = withDb(base, dbName);
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });
  return teardown;
}

async function teardown() {
  if (!dbName) return;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
}
