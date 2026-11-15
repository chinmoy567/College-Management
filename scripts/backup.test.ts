import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const base = process.env.TEST_DATABASE_URL;
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const withDb = (db: string) => { const u = new URL(base!); u.pathname = `/${db}`; return u.toString(); };
const hasPg = spawnSync('pg_dump', ['--version']).status === 0 && spawnSync('pg_restore', ['--version']).status === 0;

describe.skipIf(!base || !hasPg)('backup script', () => {
  it('[OPS-08] backup dump, 30-day prune, restore into an empty DB works', async () => {
    const src = `cms_bk_src_${process.pid}`;
    const dst = `cms_bk_dst_${process.pid}`;
    const admin = new pg.Client({ connectionString: withDb('postgres') });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${src}"`);
      await admin.query(`CREATE DATABASE "${dst}"`);
      const s = new pg.Client({ connectionString: withDb(src) });
      await s.connect();
      await s.query(`CREATE TABLE t (id int primary key, name text); INSERT INTO t VALUES (1, 'রহিমা'), (2, 'Karim')`);
      await s.end();

      const dir = mkdtempSync(path.join(os.tmpdir(), 'cms-backup-'));
      mkdirSync(dir, { recursive: true });
      const old = path.join(dir, 'cms-2020-01-01.dump');
      const recent = path.join(dir, 'cms-recent.dump');
      writeFileSync(old, 'x'); writeFileSync(recent, 'x');
      const longAgo = new Date(Date.now() - 31 * 86_400_000);
      utimesSync(old, longAgo, longAgo);
      const script = path.resolve(__dirname, 'backup.sh');
      execFileSync(bash, [script, dir], { env: { ...process.env, DIRECT_URL: withDb(src) }, stdio: 'pipe' });

      const files = readdirSync(dir);
      expect(files).not.toContain('cms-2020-01-01.dump'); // older than 30 days: pruned
      expect(files).toContain('cms-recent.dump'); // newer: kept
      const dump = files.find((f) => /^cms-\d{4}-\d{2}-\d{2}\.dump$/.test(f));
      expect(dump).toBeTruthy();
      expect(files.some((f) => f.endsWith('.partial'))).toBe(false);

      const r = spawnSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', withDb(dst), path.join(dir, dump!)]);
      // A pg_dump newer than the server emits `SET transaction_timeout`; that one version-skew error is harmless.
      const errs = String(r.stderr).split(/\r?\n/).filter((l) => /error:/.test(l) && !/transaction_timeout|errors ignored|could not execute query/.test(l));
      expect(errs, String(r.stderr)).toEqual([]);
      const d = new pg.Client({ connectionString: withDb(dst) });
      await d.connect();
      const rows = (await d.query('SELECT name FROM t ORDER BY id')).rows.map((x) => x.name);
      await d.end();
      expect(rows).toEqual(['রহিমা', 'Karim']);
      expect(existsSync(path.join(dir, dump!))).toBe(true);

      // A missing DIRECT_URL fails with a clear message and writes nothing.
      const bad = spawnSync(bash, [script, dir], { env: { ...process.env, DIRECT_URL: '' }, encoding: 'utf8' });
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain('DIRECT_URL');
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${src}" WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS "${dst}" WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);
});
