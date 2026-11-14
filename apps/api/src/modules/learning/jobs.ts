import { registerJob, scheduleJob } from '../../jobs';
import { extractMaterialText } from '../ai/grounding';
import { remindOnlineClass, sweepOnlineStatuses } from './online';

/** `online_class.remind` per class (start - 15 min); a one-minute sweep stores live/ended (08 section 1). */
export async function registerLearningJobs(): Promise<void> {
  await registerJob<{ id: string; startAt: string }>('online_class.remind', async (d) => void (await remindOnlineClass(d.id, d.startAt)));
  await registerJob('online_class.sweep', sweepOnlineStatuses);
  await scheduleJob('online_class.sweep', '* * * * *', 'Asia/Dhaka');
  // PDF notes become ~1,500-character chunks for the AI assistant's course grounding (09 section 2.6).
  await registerJob<{ materialId: string; fileId: string }>('material.extract_text', async (d) => void (await extractMaterialText(d.materialId, d.fileId)));
}
