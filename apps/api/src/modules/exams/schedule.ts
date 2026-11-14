import { enqueue, jobsRunning } from '../../jobs';
import { logger } from '../../lib/logger';

/**
 * Exam jobs only make things timely; correctness never depends on them (05 §4.2). Scheduling is best-effort:
 * with jobs not running (tests, local scripts) nothing is queued and the lazy paths do the work.
 */
async function safe(name: string, data: object, startAfter?: Date): Promise<void> {
  if (!jobsRunning()) return;
  try {
    await enqueue(name, data, startAfter ? { startAfter } : {});
  } catch (err) {
    logger.warn({ err, name }, 'exam job could not be scheduled');
  }
}

export const scheduleAutoSubmit = (attemptId: string, at: Date) => safe('exam.auto_submit', { attemptId }, at);
export const scheduleCloseCheck = (examId: string, at: Date) => safe('exam.close_check', { examId }, at);

export async function scheduleExamJobs(exam: { id: string; startAt: Date; endAt: Date }): Promise<void> {
  await safe('exam.starting_soon', { examId: exam.id }, new Date(Math.max(Date.now(), exam.startAt.getTime() - 15 * 60_000)));
  await scheduleCloseCheck(exam.id, exam.endAt);
}

/** Regrading runs as a job when the queue is up; otherwise inline, so a key fix is never lost. */
export async function scheduleRegrade(examId: string, inline: () => Promise<void>): Promise<void> {
  if (!jobsRunning()) return inline();
  await safe('exam.regrade', { examId });
}
