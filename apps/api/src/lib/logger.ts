import type { Writable } from 'node:stream';
import pino from 'pino';

export const REDACT_PATHS = [
  'password', 'token', 'cookie', 'authorization', 'totp', 'code', 'backupCode',
  'GROQ_API_KEY', 'SMTP_PASS',
  '*.password', '*.token', '*.cookie', '*.authorization', '*.totp', '*.code', '*.backupCode',
  '*.GROQ_API_KEY', '*.SMTP_PASS',
  'req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]',
];

export function createLogger(destination?: Writable) {
  return pino(
    {
      level: process.env.NODE_ENV === 'test' && !destination ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    },
    destination,
  );
}

export const logger = createLogger();
