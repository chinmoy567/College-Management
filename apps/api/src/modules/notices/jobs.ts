import { registerJob, scheduleJob } from '../../jobs';
import { publishDue, publishNotice } from './service';

/** `notice.publish` per notice (startAfter = publishAt) plus a one-minute sweep as the safety net (07 §3.3). */
export async function registerNoticeJobs(): Promise<void> {
  await registerJob<{ id: string }>('notice.publish', async (d) => void (await publishNotice(d.id)));
  await registerJob('notice.sweep', async () => void (await publishDue()));
  await scheduleJob('notice.sweep', '* * * * *', 'Asia/Dhaka');
}
