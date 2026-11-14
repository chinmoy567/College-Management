import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

const full = {
  DATABASE_URL: 'postgresql://x', DIRECT_URL: 'postgresql://x', SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'k', SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p',
  SMTP_FROM: 'f@x.edu', GROQ_API_KEY: 'g', APP_URL: 'http://localhost:3000',
  SEED_ADMIN_EMAIL: 'a@x.edu', SEED_ADMIN_PASSWORD: 'longenough', TOTP_ENC_KEY: 't',
  VAPID_PUBLIC_KEY: 'v', VAPID_PRIVATE_KEY: 'v', VAPID_SUBJECT: 'mailto:o@x.edu',
};

describe('config', () => {
  it('[OPS-02] refuses to start and lists missing env vars', () => {
    const r = parseConfig({ ...full, GROQ_API_KEY: '', DATABASE_URL: undefined } as unknown as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.sort()).toEqual(['DATABASE_URL', 'GROQ_API_KEY']);
  });

  it('[OPS-02] accepts a complete environment', () => {
    expect(parseConfig(full as unknown as NodeJS.ProcessEnv).ok).toBe(true);
  });
});
