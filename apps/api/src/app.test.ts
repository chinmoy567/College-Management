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
    expect(a.headers['x-content-type-options']).toBe('nosniff');
    expect(a.headers['x-powered-by']).toBeUndefined();
  });

  it('unknown /api route returns the error shape', async () => {
    const r = await request(createApp()).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });
});
