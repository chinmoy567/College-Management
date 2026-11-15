import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SETTING_DEFAULTS, SETTING_KEYS } from '@cms/shared';
import { runSeed } from '../../../../prisma/seed';
import { newPrisma } from './testDb';

const env = { SEED_ADMIN_EMAIL: 'Admin@Example.edu', SEED_ADMIN_PASSWORD: 'ChangeMe-123', SEED_DEMO: 'true' };
let prisma: PrismaClient;

beforeAll(() => {
  prisma = newPrisma();
});
afterAll(() => prisma.$disconnect());

const snapshot = async () => ({
  users: await prisma.user.findMany({ where: { role: 'admin' }, orderBy: { id: 'asc' } }),
  settings: await prisma.setting.findMany({ orderBy: { key: 'asc' } }),
  periods: await prisma.period.findMany({ where: { id: { startsWith: 'seed-period-' } }, orderBy: { id: 'asc' } }),
});

describe('seed', () => {
  it('[DB-01] migrations applied cleanly and the seed can run twice without changes', async () => {
    const migrations = await prisma.$queryRaw<{ finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT finished_at, rolled_back_at FROM _prisma_migrations`;
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.every((m) => m.finished_at && !m.rolled_back_at)).toBe(true);

    await runSeed(prisma, env);
    const first = await snapshot();
    await runSeed(prisma, env);
    const second = await snapshot();
    expect(second).toEqual(first); // same rows, same values, same updated_at
    expect(first.users).toHaveLength(1);
    expect(first.periods.length).toBeGreaterThan(0);
  });

  it('[DB-01] the seeded Admin has an argon2 hash, must change the password', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin' } });
    expect(admin.email).toBe('admin@example.edu');
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin.passwordHash).not.toContain('ChangeMe');
    expect(admin.mustChangePassword).toBe(true);
  });

  it('[DB-04] the seed never creates a second Admin', async () => {
    await expect(runSeed(prisma, { ...env, SEED_ADMIN_EMAIL: 'someone.else@example.edu' })).rejects.toThrow(/exactly one Admin/);
    await runSeed(prisma, env);
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1);
  });

  it('[DB-05] all settings keys are seeded with their defaults', async () => {
    const rows = await prisma.setting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    for (const key of SETTING_KEYS) {
      expect(byKey.has(key), `missing setting ${key}`).toBe(true);
      expect(byKey.get(key), key).toEqual(SETTING_DEFAULTS[key]);
    }
    // the spec 01 section 4 list, written out so a rename in settings.ts is noticed
    expect([...SETTING_KEYS].sort()).toEqual(
      ['ai_daily_limit', 'ai_model', 'ai_provider', 'attendance_colours', 'attendance_threshold', 'banned_words_enabled',
        'college_profile', 'email_daily_limit', 'grading_scale', 'maintenance_window', 'pin_days'].sort(),
    );
  });

  it('[DB-05] re-seeding keeps a value the Admin has changed', async () => {
    await prisma.setting.update({ where: { key: 'pin_days' }, data: { value: 14 } });
    await runSeed(prisma, env);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'pin_days' } })).value).toBe(14);
    await prisma.setting.update({ where: { key: 'pin_days' }, data: { value: 7 } });
  });
});
