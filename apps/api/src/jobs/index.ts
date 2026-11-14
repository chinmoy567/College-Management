import PgBoss from 'pg-boss';
import { logger } from '../lib/logger';

let boss: PgBoss | undefined;

export async function startJobs(databaseUrl: string): Promise<PgBoss> {
  boss = new PgBoss(databaseUrl);
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  return boss;
}

export async function registerJob<T extends object>(
  name: string,
  handler: (data: T) => Promise<void>,
): Promise<void> {
  if (!boss) throw new Error('Jobs not started');
  await boss.createQueue(name);
  await boss.work<T>(name, async (jobs) => {
    for (const j of jobs) await handler(j.data);
  });
}

export async function stopJobs(): Promise<void> {
  await boss?.stop();
  boss = undefined;
}

export async function enqueue(
  name: string,
  data: object,
  opts: { priority?: number; startAfter?: Date; retryLimit?: number } = {},
): Promise<void> {
  if (!boss) throw new Error('Jobs not started');
  await boss.send(name, data, { retryLimit: 3, retryBackoff: true, ...opts });
}

/** Cron schedule (pg-boss) in a time zone; replaces an existing schedule of the same name. */
export async function scheduleJob(name: string, cron: string, tz: string): Promise<void> {
  if (!boss) throw new Error('Jobs not started');
  await boss.createQueue(name);
  await boss.schedule(name, cron, {}, { tz });
}
