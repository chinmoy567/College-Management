import { prisma } from '../../db';
import { now as clockNow } from '../../lib/clock';
import { notify } from '../../lib/notify';
import { finaliseAttempt } from './finalise';

export const enrolledStudentIds = async (offeringId: string): Promise<string[]> =>
  (await prisma.enrollment.findMany({ where: { courseOfferingId: offeringId, status: 'active' }, select: { studentId: true } })).map((e) => e.studentId);

/**
 * Reveal (05 §4.3): `now >= endAt` and no attempt of the exam in progress. Expired attempts are finished first.
 * Sets `revealedAt`, closes the exam and, in instant mode, publishes the results. Idempotent and safe to run late.
 * Returns true when the exam is revealed after the call.
 */
export async function ensureRevealed(examId: string, at: Date = clockNow()): Promise<boolean> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, title: true, status: true, endAt: true, revealedAt: true, resultMode: true, courseOfferingId: true },
  });
  if (!exam || exam.status === 'draft') return false;
  if (exam.revealedAt) return true;
  if (at < exam.endAt) return false;
  const expired = await prisma.examAttempt.findMany({ where: { examId, status: 'in_progress', deadlineAt: { lte: at } }, select: { id: true } });
  for (const a of expired) await finaliseAttempt(a.id, 'deadline', undefined, at);
  if ((await prisma.examAttempt.count({ where: { examId, status: 'in_progress' } })) > 0) return false;
  const r = await prisma.exam.updateMany({
    where: { id: examId, revealedAt: null },
    data: { revealedAt: at, status: 'closed', ...(exam.resultMode === 'instant' ? { resultsPublishedAt: at } : {}) },
  });
  if (r.count === 1 && exam.resultMode === 'instant') {
    await notify(await enrolledStudentIds(exam.courseOfferingId), 'result_published', { type: 'exam', id: examId }, `Results of "${exam.title}" are out.`);
  }
  return true;
}

/** Lazy reveal for every exam in the list whose window is over and which is not revealed yet. */
export async function revealDue(exams: { id: string; endAt: Date; revealedAt: Date | null; status: string }[], at: Date = clockNow()): Promise<void> {
  for (const e of exams) if (!e.revealedAt && e.status !== 'draft' && at >= e.endAt) await ensureRevealed(e.id, at);
}
