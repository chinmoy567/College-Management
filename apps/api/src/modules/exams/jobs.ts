import { registerJob } from '../../jobs';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { notify } from '../../lib/notify';
import { regradeExam } from './changes';
import { finaliseAttempt, finaliseExpiredAttempts } from './finalise';
import { ensureRevealed, enrolledStudentIds } from './reveal';
import { scheduleAutoSubmit, scheduleCloseCheck } from './schedule';

/** pg-boss handlers (11 §1). Each is idempotent and safe to run late; exam correctness never depends on them. */

/** `exam.auto_submit` at `deadlineAt`: finish the attempt, or re-schedule when extra time moved the deadline. */
export async function runAutoSubmit({ attemptId }: { attemptId: string }, at: Date = now()): Promise<void> {
  const a = await prisma.examAttempt.findUnique({ where: { id: attemptId }, select: { id: true, examId: true, status: true, deadlineAt: true } });
  if (!a || a.status !== 'in_progress') return;
  if (at < a.deadlineAt) return void (await scheduleAutoSubmit(a.id, a.deadlineAt));
  await finaliseAttempt(a.id, 'deadline', undefined, at);
  await ensureRevealed(a.examId, at);
}

/** `exam.starting_soon` at start − 15 min; a second run (after a reschedule) does not notify twice. */
export async function runStartingSoon({ examId }: { examId: string }, at: Date = now()): Promise<void> {
  const e = await prisma.exam.findUnique({ where: { id: examId }, select: { id: true, title: true, status: true, startAt: true, courseOfferingId: true } });
  if (!e || e.status !== 'published' || at >= e.startAt || e.startAt.getTime() - at.getTime() > 16 * 60_000) return;
  if (await prisma.notification.findFirst({ where: { type: 'exam_starting_soon', refType: 'exam', refId: e.id }, select: { id: true } })) return;
  await notify(await enrolledStudentIds(e.courseOfferingId), 'exam_starting_soon', { type: 'exam', id: e.id }, `"${e.title}" starts in 15 minutes.`);
}

/** `exam.close_check` at `endAt`, then every 5 minutes while attempts are still running. */
export async function runCloseCheck({ examId }: { examId: string }, at: Date = now()): Promise<void> {
  const e = await prisma.exam.findUnique({ where: { id: examId }, select: { id: true, status: true, endAt: true, revealedAt: true } });
  if (!e || e.status === 'draft' || e.revealedAt || at < e.endAt) return;
  if (!(await ensureRevealed(examId, at))) await scheduleCloseCheck(examId, new Date(at.getTime() + 5 * 60_000));
}

export async function registerExamJobs(): Promise<void> {
  await registerJob<{ attemptId: string }>('exam.auto_submit', (d) => runAutoSubmit(d));
  await registerJob<{ examId: string }>('exam.starting_soon', (d) => runStartingSoon(d));
  await registerJob<{ examId: string }>('exam.close_check', (d) => runCloseCheck(d));
  await registerJob<{ examId: string }>('exam.regrade', async (d) => void (await regradeExam(d.examId)));
  await finaliseExpiredAttempts(); // on boot: finish whatever ran out while the server slept
}
