import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) } }));

import { createApp } from './app';

describe('app', () => {
  it('[OPS-01] health needs no login and returns only ok', async () => {
    const r = await request(createApp()).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.text).toBe('ok');
  });

  it('[OPS-04] sets CSP with a per-request nonce and security headers', async () => {
    const a = await request(createApp()).get('/api/health');
    const b = await request(createApp()).get('/api/health');
    const csp = a.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp.match(/'nonce-[^']+'/)![0]).not.toBe((b.headers['content-security-policy'] as string).match(/'nonce-[^']+'/)![0]);
    expect(csp).toMatch(/img-src [^;]*'self'[^;]*data:[^;]*blob:/);
    expect(csp).toMatch(/frame-src [^;]*youtube-nocookie\.com[^;]*drive\.google\.com/);
    expect(csp).toMatch(/connect-src [^;]*'self'[^;]*wss:/);
    expect(csp).toContain("object-src 'none'");
    expect(a.headers['x-content-type-options']).toBe('nosniff');
    expect(a.headers['strict-transport-security']).toBeTruthy();
    expect(a.headers['x-powered-by']).toBeUndefined();
  });

  it('unknown /api route returns the error shape', async () => {
    const r = await request(createApp()).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });
});

describe('request logging', () => {
  it('[CONV-06] logs never contain bodies, query strings, cookies or message text', async () => {
    const { Writable } = await import('node:stream');
    const { createLogger } = await import('./lib/logger');
    const lines: string[] = [];
    const dest = new Writable({ write(c, _e, cb) { lines.push(String(c)); cb(); } });
    const a = createApp({ logger: createLogger(dest) });
    a.post('/api/echo-test', (_req, res) => res.json({ ok: true }));
    await request(a)
      .post('/api/echo-test?search=secret-query')
      .set('Cookie', 'cms_session=sess-abc')
      .set('Authorization', 'Bearer tok-xyz')
      .send({ body: 'my private chat message', password: 'pw-999', prompt: 'ai question text' });
    const out = lines.join('');
    expect(out).toContain('/api/echo-test');
    for (const s of ['my private chat message', 'pw-999', 'ai question text', 'secret-query', 'sess-abc', 'tok-xyz']) {
      expect(out).not.toContain(s);
    }
  });
});
