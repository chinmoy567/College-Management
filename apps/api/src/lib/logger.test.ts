import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

describe('logger', () => {
  it('[CONV-06] logs redact secrets and content', () => {
    const lines: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger(dest);
    log.info(
      {
        password: 'pw-123',
        token: 'tok-123',
        totp: '123456',
        backupCode: 'bk-123',
        user: { password: 'pw-nested', code: 'c-123' },
        req: { headers: { cookie: 'cms_session=abc', authorization: 'Bearer zzz' } },
        GROQ_API_KEY: 'gsk_secret',
        SMTP_PASS: 'smtp-secret',
      },
      'login attempt',
    );
    const out = lines.join('');
    for (const secret of ['pw-123', 'tok-123', '123456', 'bk-123', 'pw-nested', 'c-123', 'cms_session=abc', 'Bearer zzz', 'gsk_secret', 'smtp-secret']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[redacted]');
  });
});
