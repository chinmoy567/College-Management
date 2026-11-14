import { DISPLAY_TZ } from '@cms/shared';
import { registerJob, scheduleJob } from '../../jobs';
import { logger } from '../../lib/logger';
import { generateMeetings } from './generate';

/** `meetings.generate`: nightly at 00:30 Asia/Dhaka for [today, today+14] (04 §4). Routine edits regenerate inline. */
export async function registerMeetingJob(): Promise<void> {
  await registerJob<{ from?: string; to?: string }>('meetings.generate', async (data) => {
    const r = await generateMeetings(data);
    logger.info(r, 'meetings generated');
  });
  await scheduleJob('meetings.generate', '30 0 * * *', DISPLAY_TZ);
}
