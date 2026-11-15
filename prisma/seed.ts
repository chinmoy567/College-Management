/**
 * Idempotent base seed (docs/spec/01-database.md §5).
 *  - the single Admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (throws if another Admin exists)
 *  - the Settings rows with their defaults (existing values are never overwritten)
 *  - example periods and rooms, only when SEED_DEMO=true (the demo routine is prisma/seed-routine.ts)
 * `--demo` (npm run db:seed:demo) also runs prisma/seed-demo.ts.
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { Prisma, PrismaClient } from '@prisma/client';
import { SETTING_DEFAULTS, SETTING_KEYS } from '../packages/shared/src/settings';

export interface SeedEnv {
  [key: string]: string | undefined;
  SEED_ADMIN_EMAIL?: string;
  SEED_ADMIN_PASSWORD?: string;
  SEED_DEMO?: string;
}

export async function seedAdmin(prisma: PrismaClient, env: SeedEnv): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required.');
  const existing = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (existing) {
    if (existing.email !== email) {
      throw new Error(
        'An Admin with a different email already exists. There is exactly one Admin; refusing to create another.',
      );
    }
    return; // same Admin: nothing to change (never reset a password the Admin has already changed)
  }
  await prisma.user.create({
    data: {
      email,
      role: 'admin',
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      emailVerifiedAt: new Date(), // the deployer sets this address, so forgot-password works for the Admin
      mustChangePassword: true,
    },
  });
}

export async function seedSettings(prisma: PrismaClient): Promise<void> {
  for (const key of SETTING_KEYS) {
    const value = SETTING_DEFAULTS[key] as unknown;
    const json = value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
    // update: {} keeps values the Admin has already changed
    await prisma.setting.upsert({ where: { key }, create: { key, value: json }, update: {} });
  }
}

const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/** 8 periods of 45 minutes; the break (10:25-10:50) is the gap between Period 3 and Period 4. */
export const DEMO_PERIODS = [
  ['Period 1', '08:00', '08:45'],
  ['Period 2', '08:50', '09:35'],
  ['Period 3', '09:40', '10:25'],
  ['Period 4', '10:50', '11:35'],
  ['Period 5', '11:40', '12:25'],
  ['Period 6', '12:30', '13:15'],
  ['Period 7', '13:20', '14:05'],
  ['Period 8', '14:10', '14:55'],
] as const;

export async function seedPeriods(prisma: PrismaClient): Promise<void> {
  for (const [i, [name, from, to]] of DEMO_PERIODS.entries()) {
    const id = `seed-period-${i + 1}`;
    // update: demo periods are normalised to the times above on every run
    await prisma.period.upsert({
      where: { id },
      create: { id, name, startTime: t(from), endTime: t(to) },
      update: { name, startTime: t(from), endTime: t(to), deletedAt: null },
    });
  }
}

/** [key, name, building, capacity]. 6 home classrooms (one per section), 4 labs, 1 spare. */
export const DEMO_ROOMS = [
  ['101', 'Room 101', 'Building A', 40],
  ['102', 'Room 102', 'Building A', 40],
  ['103', 'Room 103', 'Building A', 40],
  ['104', 'Room 104 (spare)', 'Building A', 40],
  ['201', 'Room 201', 'Building B', 40],
  ['202', 'Room 202', 'Building B', 40],
  ['203', 'Room 203', 'Building B', 40],
  ['phy-lab', 'Physics Lab', 'Science Block', 35],
  ['che-lab', 'Chemistry Lab', 'Science Block', 35],
  ['bio-lab', 'Biology Lab', 'Science Block', 35],
  ['ict-lab', 'Computer Lab', 'Science Block', 35],
] as const;

export const demoRoomId = (key: string) => `seed-room-${key}`;

export async function seedRooms(prisma: PrismaClient): Promise<void> {
  for (const [key, name, building, capacity] of DEMO_ROOMS) {
    const id = demoRoomId(key);
    await prisma.room.upsert({
      where: { id },
      create: { id, name, building, capacity },
      update: { name, building, capacity, deletedAt: null },
    });
  }
}

export async function runSeed(prisma: PrismaClient, env: SeedEnv = process.env): Promise<void> {
  await seedAdmin(prisma, env);
  await seedSettings(prisma);
  if (env.SEED_DEMO === 'true') {
    await seedPeriods(prisma);
    await seedRooms(prisma);
  }
}

async function main() {
  const demo = process.argv.includes('--demo');
  const prisma = new PrismaClient();
  try {
    await runSeed(prisma, demo ? { ...process.env, SEED_DEMO: 'true' } : process.env);
    if (demo) {
      const { seedDemo } = await import('./seed-demo');
      await seedDemo(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
