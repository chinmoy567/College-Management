/**
 * Fails when prisma/schema.prisma and prisma/migrations disagree.
 *
 * Prisma cannot express a few objects (trigram and tsvector indexes, the generated tsv column), so
 * `prisma migrate diff` always lists them as "to drop". Those exact statements are expected and allowed.
 * Anything else means a real drift (schema changed without a migration, or a migration edited by hand
 * in a way the schema does not know) and the check fails. Run it after every schema change.
 *
 * Usage: npm run db:drift   (needs SHADOW_DATABASE_URL, or DATABASE_URL to derive "<db>_shadow" from)
 */
import { execFileSync } from 'node:child_process';
import 'dotenv/config';

/** Raw-SQL objects Prisma does not model. Keep in sync with the "raw:" notes in schema.prisma. */
export const ALLOWED_RAW_DROPS: readonly string[] = [
  'DROP INDEX "material_chunks_tsv_idx";',
  'DROP INDEX "special_days_uq";',
  'DROP INDEX "student_profiles_name_trgm_idx";',
  'DROP INDEX "users_login_id_trgm_idx";',
  'ALTER TABLE "material_chunks" DROP COLUMN "tsv";',
];

/** Returns the statements of a `migrate diff --script` output that are not expected raw-object drops. */
export function unexpectedStatements(script: string): string[] {
  return script
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
    .filter((l) => !ALLOWED_RAW_DROPS.includes(l));
}

function shadowUrl(): string {
  if (process.env.SHADOW_DATABASE_URL) return process.env.SHADOW_DATABASE_URL;
  const base = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error('Set SHADOW_DATABASE_URL (an empty database) or DATABASE_URL.');
  const u = new URL(base);
  u.pathname = `${u.pathname}_shadow`;
  return u.toString();
}

function main() {
  const out = execFileSync(
    'npx',
    [
      'prisma', 'migrate', 'diff',
      '--from-migrations', 'prisma/migrations',
      '--to-schema-datamodel', 'prisma/schema.prisma',
      '--shadow-database-url', shadowUrl(),
      '--script',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  const bad = unexpectedStatements(out);
  if (bad.length) {
    console.error('Schema drift: prisma/schema.prisma and the migrations disagree.\n' + bad.join('\n'));
    process.exit(1);
  }
  console.log('No schema drift (only the known raw-SQL objects differ).');
}

if (process.argv[1] && /db-drift-check/.test(process.argv[1])) main();
