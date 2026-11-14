import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { newPool } from './testDb';

let pool: pg.Pool;
beforeAll(() => {
  pool = newPool();
});
afterAll(() => pool.end());

describe('row level security', () => {
  it('[DB-02] RLS is enabled on every table in public, including _prisma_migrations', async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname`,
    );
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.map((r) => r.relname)).toContain('_prisma_migrations');
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it('[DB-02] no policies exist, so the public REST key can read nothing', async () => {
    const { rows } = await pool.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'public'`);
    expect(rows).toEqual([]);
  });
});
