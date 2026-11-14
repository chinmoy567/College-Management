import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { extendBody, fixKeyBody, checkQuestionShape, id } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { logger } from '../../lib/logger';
import { notify } from '../../lib/notify';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { examForOwner } from './access';
import { gradeAttempt } from './finalise';
import { scheduleAutoSubmit, scheduleCloseCheck, scheduleRegrade } from './schedule';

/** After the start (05 §6): fix an answer key, cancel a question, give extra time or reopen an attempt. */
export const changesRouter = Router(); // mounted at /api/exams (/:id/questions/...)
export const extendRouter = Router(); // mounted at /api/exams/attempts
const teacher = requireRole('teacher');
const me = (req: unknown) => (req as AuthedRequest).user.id;

const BATCH = 200;
/** Regrades every finished attempt of an exam from its saved answers (idempotent), 200 attempts per transaction. */
export async function regradeExam(examId: string): Promise<number> {
  let n = 0;
  for (let cursor: string | undefined; ; ) {
    const batch = await prisma.examAttempt.findMany({
      where: { examId, status: { in: ['submitted', 'auto_submitted'] }, score: { not: null } },
      select: { id: true }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    await prisma.$transaction(async (tx) => {
      for (const a of batch) await tx.examAttempt.update({ where: { id: a.id }, data: { score: await gradeAttempt(tx, a.id, examId) } });
    }, { timeout: 30_000 });
    n += batch.length;
    cursor = batch[batch.length - 1]!.id;
  }
  logger.info({ examId, attempts: n }, 'exam regraded');
  return n;
}

async function afterChange(examId: string, title: string, text: string): Promise<void> {
  await scheduleRegrade(examId, async () => void (await regradeExam(examId)));
  const takers = await prisma.examAttempt.findMany({ where: { examId }, select: { studentId: true }, distinct: ['studentId'] });
  await notify(takers.map((t) => t.studentId), 'exam_key_fixed', { type: 'exam', id: examId }, `${text} in "${title}". Your score has been updated.`);
}

const qParams = validate({ params: z.object({ id, qid: id }) });
async function startedQuestion(req: unknown, examId: string, qid: string) {
  const exam = await examForOwner(req, examId);
  if (exam.status === 'draft') throw new AppError('CONFLICT', 409, 'Edit a draft exam directly.');
  const q = await prisma.examQuestion.findFirst({ where: { id: qid, examId } });
  if (!q) throw new AppError('NOT_FOUND', 404, 'Question not found.');
  return { exam, q };
}

changesRouter.post('/:id/questions/:qid/fix-key', teacher, qParams, validate({ body: fixKeyBody }), asyncHandler(async (req, res) => {
  const { exam, q } = await startedQuestion(req, req.params.id as string, req.params.qid as string);
  const correct = [...new Set((req.body as z.infer<typeof fixKeyBody>).correct)].sort();
  const opts = (q.options as { id: string }[]).map((o) => o.id);
  const msg = checkQuestionShape({ type: q.type, optionCount: opts.length, correct: correct.map((c) => opts.indexOf(c)) });
  if (msg || correct.some((c) => !opts.includes(c))) throw new AppError('VALIDATION_ERROR', 400, msg ?? 'That option does not belong to this question.', { correct: msg ?? 'Unknown option' });
  await prisma.$transaction(async (tx) => {
    await tx.examQuestion.update({ where: { id: q.id }, data: { correct } });
    await tx.examChangeLog.create({ data: { examId: exam.id, examQuestionId: q.id, change: { from: q.correct, to: correct } as Prisma.InputJsonValue, changedBy: me(req) } });
  });
  await afterChange(exam.id, exam.title, 'An answer key was corrected');
  res.json({ ok: true });
}));

changesRouter.post('/:id/questions/:qid/cancel', teacher, qParams, asyncHandler(async (req, res) => {
  const { exam, q } = await startedQuestion(req, req.params.id as string, req.params.qid as string);
  if (!q.isCancelled) {
    await prisma.$transaction(async (tx) => {
      await tx.examQuestion.update({ where: { id: q.id }, data: { isCancelled: true } });
      await tx.examChangeLog.create({ data: { examId: exam.id, examQuestionId: q.id, change: { cancelled: true }, changedBy: me(req) } });
    });
    await afterChange(exam.id, exam.title, 'A question was cancelled (everyone gets its marks)');
  }
  res.json({ ok: true });
}));

// ───── extra time / reopen ─────
extendRouter.post('/:id/extend', teacher, validate({ params: z.object({ id }), body: extendBody }), asyncHandler(async (req, res) => {
  const { minutes, reopen } = req.body as z.infer<typeof extendBody>;
  const at = now();
  const found = await prisma.examAttempt.findUnique({ where: { id: req.params.id as string }, select: { examId: true } });
  if (!found) throw new AppError('NOT_FOUND', 404, 'Attempt not found.');
  const exam = await examForOwner(req, found.examId);
  if (exam.status === 'draft') throw new AppError('CONFLICT', 409, 'This exam is not published.');
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM exam_attempts WHERE id = ${req.params.id as string} FOR UPDATE`);
    const a = await tx.examAttempt.findUniqueOrThrow({ where: { id: req.params.id as string } });
    const latest = await tx.examAttempt.aggregate({ where: { examId: a.examId, studentId: a.studentId }, _max: { attemptNo: true } });
    if (a.attemptNo !== latest._max.attemptNo) throw new AppError('CONFLICT', 409, 'Only the latest attempt can get extra time.');
    let deadlineAt: Date;
    if (a.status === 'in_progress') {
      // time may have run out without the job having finished the attempt yet: count from now then
      deadlineAt = new Date(Math.max(a.deadlineAt.getTime(), at.getTime()) + minutes * 60_000);
      await tx.examAttempt.update({ where: { id: a.id }, data: { deadlineAt, extraMinutes: { increment: minutes } } });
    } else {
      if (!reopen) throw new AppError('CONFLICT', 409, 'This attempt is finished. Send reopen: true to reopen it.');
      deadlineAt = new Date(at.getTime() + minutes * 60_000);
      await tx.examAttempt.update({ where: { id: a.id }, data: { status: 'in_progress', deadlineAt, submittedAt: null, score: null, extraMinutes: { increment: minutes } } });
      await tx.answer.updateMany({ where: { attemptId: a.id }, data: { isCorrect: null, marksAwarded: null } });
      // the exam was already revealed: take the reveal back until this attempt is finished again
      if (exam.revealedAt) {
        await tx.exam.update({ where: { id: exam.id }, data: { revealedAt: null, status: 'published', ...(exam.resultMode === 'instant' ? { resultsPublishedAt: null } : {}) } });
      }
    }
    await tx.attemptExtension.create({ data: { attemptId: a.id, minutes, reopened: !!reopen && a.status !== 'in_progress', givenBy: me(req) } });
    return { id: a.id, deadlineAt };
  });
  await scheduleAutoSubmit(result.id, result.deadlineAt);
  await scheduleCloseCheck(exam.id, result.deadlineAt);
  res.json({ id: result.id, status: 'in_progress', deadlineAt: result.deadlineAt });
}));
