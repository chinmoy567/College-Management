import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const statics = path.join(root, 'apps/web/.next/static');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Names in .env.example that must never reach the browser (everything except NEXT_PUBLIC_*, NODE_ENV and plain config words). */
const serverNames = (): string[] =>
  readFileSync(path.join(root, '.env.example'), 'utf8')
    .split(/\r?\n/)
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((n): n is string => !!n && !n.startsWith('NEXT_PUBLIC_') && n !== 'NODE_ENV');

describe('browser bundle', () => {
  it('[OPS-04] .env.example only exposes NEXT_PUBLIC_* to the browser', () => {
    const names = serverNames();
    expect(names).toEqual(expect.arrayContaining(['GROQ_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PRIVATE_KEY']));
    const next = readFileSync(path.join(root, 'apps/web/next.config.mjs'), 'utf8');
    expect(next).not.toMatch(/\benv\s*:/); // no `env` block that would inline server variables
  });

  it.skipIf(!existsSync(statics))('[OPS-04] built browser bundle contains no server env names or secret values', () => {
    const files = walk(statics).filter((f) => /\.(js|css|html|json|map)$/.test(f));
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    // Short generic names (PORT, TZ_DISPLAY...) occur in library code by chance; check the distinctive ones.
    for (const n of serverNames().filter((x) => x.includes('_') && x.length >= 9)) expect(new RegExp(`(?<![A-Z0-9_])${n}(?![A-Z0-9_])`).test(text), `${n} found in browser bundle`).toBe(false);
    // Real values from the local env file, when set, must not appear either.
    for (const n of ['GROQ_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PRIVATE_KEY', 'SMTP_PASS', 'SEED_ADMIN_PASSWORD']) {
      const v = process.env[n];
      if (v && v.length >= 8) expect(text.includes(v), `${n} value found in browser bundle`).toBe(false);
    }
  });
});
