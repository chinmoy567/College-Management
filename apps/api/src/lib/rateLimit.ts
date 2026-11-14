import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from './http';

/** Fixed-window counters stored in RateLimitHit (02 §6). One SQL round-trip per hit. */
function windowStart(windowMs: number, now = Date.now()): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

export async function hit(key: string, windowMs: number): Promise<number> {
  const ws = windowStart(windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO rate_limit_hits ("key", window_start, count) VALUES (${key}, ${ws}, 1)
    ON CONFLICT ("key", window_start) DO UPDATE SET count = rate_limit_hits.count + 1
    RETURNING count`);
  return rows[0]!.count;
}

export async function peek(key: string, windowMs: number): Promise<number> {
  const row = await prisma.rateLimitHit.findUnique({
    where: { key_windowStart: { key, windowStart: windowStart(windowMs) } },
  });
  return row?.count ?? 0;
}

export function limitedError(windowMs: number, now = Date.now()): AppError {
  const mins = Math.max(1, Math.ceil((windowStart(windowMs, now).getTime() + windowMs - now) / 60000));
  return new AppError('RATE_LIMITED', 429, `Too many attempts, try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
}

/** Counts a hit and throws 429 when over the limit. */
export async function consume(key: string, limit: number, windowMs: number): Promise<void> {
  if ((await hit(key, windowMs)) > limit) throw limitedError(windowMs);
}

/** Throws 429 if already at/over the limit, without counting (used for failure-only counters). */
export async function assertUnder(key: string, limit: number, windowMs: number): Promise<void> {
  if ((await peek(key, windowMs)) >= limit) throw limitedError(windowMs);
}

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export async function purgeOldHits(olderThanMs = 2 * DAY): Promise<number> {
  const r = await prisma.rateLimitHit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - olderThanMs) } } });
  return r.count;
}
