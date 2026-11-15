import { DISPLAY_TZ } from '@cms/shared';
import { registerJob, scheduleJob } from '../../jobs';
import { logger } from '../../lib/logger';
import { generateMeetings } from './generate';

/** `meetings.generate`: nightly at 00:30 Asia/Dhaka for [today, today+14] (04 ยง4). Routine edits regenerate inline. */
export async function registerMeetingJob(): Promise<void> {
  await registerJob<{ from?: string; to?: string }>('meetings.generate', async (data) => {
    const r = await generateMeetings(data);
    logger.info(r, 'meetings generated');
  });
  await scheduleJob('meetings.generate', '30 0 * * *', DISPLAY_TZ);
  // Boot catch-up (11 ง1): the free server may have slept through 00:30. Idempotent.
  generateMeetings().then((r) => logger.info(r, 'meetings catch-up'), (err) => logger.error({ err }, 'meetings catch-up failed'));
}
