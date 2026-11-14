import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_PUBLIC_BUCKET: z.string().default('public'),
  SUPABASE_PRIVATE_BUCKET: z.string().default('private'),
  SESSION_COOKIE_NAME: z.string().default('cms_session'),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int(),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  APP_URL: z.string().url(),
  TZ_DISPLAY: z.string().default('Asia/Dhaka'),
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_PASSWORD: z.string().min(8),
  TOTP_ENC_KEY: z.string().min(1),
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().min(1),
  LOG_EMAIL_LINKS: bool.default('false'),
});

export type Config = z.infer<typeof envSchema>;

/** Parse env; returns the problems instead of exiting so it is testable (OPS-02). */
export function parseConfig(
  env: NodeJS.ProcessEnv,
): { ok: true; config: Config } | { ok: false; missing: string[] } {
  const r = envSchema.safeParse(env);
  if (r.success) return { ok: true, config: r.data };
  return { ok: false, missing: [...new Set(r.error.issues.map((i) => i.path.join('.')))] };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = parseConfig(env);
  if (!r.ok) {
    console.error(`Missing or invalid environment variables: ${r.missing.join(', ')}`);
    process.exit(1);
  }
  return r.config;
}
