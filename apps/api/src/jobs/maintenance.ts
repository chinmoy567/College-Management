import { DISPLAY_TZ } from '@cms/shared';
import { prisma } from '../db';
import { now } from '../lib/clock';
import { storage } from '../lib/files';
import { logger } from '../lib/logger';
import { purgeOldHits } from '../lib/rateLimit';
import { purgeRemovedContent } from '../modules/feed/moderation';
import { registerJob, scheduleJob } from './index';

const DAY = 86_400_000;

/** `storage.purge` (11 §1): hard-delete content removed > 30 days ago, then delete storage objects marked deleted > 30 days ago. Idempotent. */
export async function runStoragePurge(): Promise<{ posts: number; comments: number; objects: number }> {
  const removed = await purgeRemovedContent();
  const objects = await storage().purge();
  return { ...removed, objects };
}

/** `housekeeping` (11 §1): old rate-limit hits, expired/used tokens, login sessions expired > 30 days. Idempotent. */
export async function runHousekeeping(at: Date = now()): Promise<{ hits: number; tokens: number; sessions: number }> {
  const hits = await purgeOldHits(DAY);
  const tokens = (await prisma.token.deleteMany({ where: { expiresAt: { lt: at } } })).count;
  const sessions = (await prisma.loginSession.deleteMany({ where: { expiresAt: { lt: new Date(at.getTime() - 30 * DAY) } } })).count;
  return { hits, tokens, sessions };
}

/** `pin.expire` (11 §1): no data change; feed queries compare `pinnedUntil` with now. Kept as a logged no-op so the schedule exists. */
export async function runPinExpire(): Promise<void> {
  logger.debug('pin.expire: nothing to change (pins are filtered by pinnedUntil at query time)');
}

export async function registerMaintenanceJobs(): Promise<void> {
  await registerJob('storage.purge', async () => void logger.info(await runStoragePurge(), 'storage purge'));
  await registerJob('housekeeping', async () => void logger.info(await runHousekeeping(), 'housekeeping'));
  await registerJob('pin.expire', runPinExpire);
  await scheduleJob('storage.purge', '0 3 * * *', DISPLAY_TZ);
  await scheduleJob('housekeeping', '30 3 * * *', DISPLAY_TZ);
  await scheduleJob('pin.expire', '0 * * * *', DISPLAY_TZ);
}
