import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { INTEGRITY_CAP, SUBMIT_GRACE_SECONDS, answerBody, id, integrityBody } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { finaliseAttempt, finaliseIfExpired } from './finalise';
import { deadline, shuffle } from './logic';
import { ensureRevealed } from './reveal';
import { scheduleAutoSubmit } from './schedule';
import { attemptPayload, resultView, takingView } from './views';

/** Taking an exam (05 §4). Student routes; the attempt is always looked up by its owner. */
export const attemptsRouter = Router();
export const startRouter = Router();
const student = requireRole('student');
const me = (req: unknown) => (req as AuthedRequest).user.id;
const idParam = validate({ params: z.object({ id }) });

// ───── start (POST /api/exams/:id/attempts) ─────
startRouter.post('/:id/attempts', student, idParam, asyncHandler(async (req, res) => {
  const studentId = me(req);
  const examId = req.params.id as string;
  const at = now();
  const out = await prisma.$transaction(async (tx) => {
    // FOR SHARE on the exam row blocks a concurrent delete/edit without serialising the other students;
    // the advisory lock serialises starts of this one student, and the partial unique index is the last backstop.
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM exams WHERE id = ${examId} FOR SHARE`);
    if (!rows[0]) throw new AppError('NOT_FOUND', 404, 'Exam not found.');
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`exam-start:${examId}:${studentId}`}))`);
    const exam = await tx.exam.findUniqueOrThrow({ where: { id: examId } });
    const enrolled = await tx.enrollment.findFirst({ where: { studentId, courseOfferingId: exam.courseOfferingId, status: 'active' }, select: { id: true } });
    if (!enrolled || exam.status === 'draft') throw new AppError('NOT_FOUND', 404, 'Exam not found.');

    // resume: an attempt already in progress (finished first if its time ran out)
    const live = await tx.examAttempt.findFirst({ where: { examId, studentId, status: 'in_progress' } });
    if (live) {
      if (at < live.deadlineAt) return { attempt: live, exam, created: false };
      await finaliseAttempt(live.id, 'deadline', tx, at);
    }
    if (exam.status !== 'published' || at < exam.startAt || at >= exam.endAt) throw new AppError('EXAM_NOT_OPEN', 409, 'This exam is not open right now.');
    const used = await tx.examAttempt.aggregate({ where: { examId, studentId }, _max: { attemptNo: true }, _count: true });
    if (exam.maxAttempts > 0 && used._count >= exam.maxAttempts) throw new AppError('NO_ATTEMPTS_LEFT', 409, 'You have used all your attempts.');

    const questions = await tx.examQuestion.findMany({ where: { examId }, select: { id: true, options: true }, orderBy: { order: 'asc' } });
    const ordered = exam.shuffleQuestions ? shuffle(questions) : questions;
    const questionOrder = ordered.map((q) => {
      const ids = (q.options as { id: string }[]).map((o) => o.id);
      return { q: q.id, o: exam.shuffleOptions ? shuffle(ids) : ids };
    });
    const profile = await tx.studentProfile.findUniqueOrThrow({ where: { userId: studentId }, select: { sectionId: true } });
    const attempt = await tx.examAttempt.create({
      data: {
        examId, studentId, attemptNo: (used._max.attemptNo ?? 0) + 1, sectionId: profile.sectionId, startedAt: at,
        deadlineAt: deadline(at, exam.durationMin, exam.endAt), questionOrder,
      },
    });
    return { attempt, exam, created: true };
  }, { timeout: 15_000 });
  if (out.created) await scheduleAutoSubmit(out.attempt.id, out.attempt.deadlineAt);
  res.status(out.created ? 201 : 200).json(await takingView(out.exam, out.attempt));
}));

// ───── during ─────
attemptsRouter.get('/:id', student, idParam, asyncHandler(async (req, res) => {
  res.json(await attemptPayload(req.params.id as string, me(req)));
}));

/** Per examQuestion: exam id, type and option ids only (never the key). Bounded; a fix-key or cancel does not change these. */
const questionCache = new Map<string, { examId: string; type: 'single' | 'multiple'; optionIds: Set<string> }>();
const CACHE_MAX = 20_000;
export const clearQuestionCache = (): void => questionCache.clear();
async function questionMeta(examQuestionId: string) {
  const hit = questionCache.get(examQuestionId);
  if (hit) {
    questionCache.delete(examQuestionId);
    questionCache.set(examQuestionId, hit); // most recently used last
    return hit;
  }
  const q = await prisma.examQuestion.findUnique({ where: { id: examQuestionId }, select: { examId: true, type: true, options: true } });
  if (!q) return null;
  const meta = { examId: q.examId, type: q.type, optionIds: new Set((q.options as { id: string }[]).map((o) => o.id)) };
  questionCache.set(examQuestionId, meta);
  if (questionCache.size > CACHE_MAX) questionCache.delete(questionCache.keys().next().value as string);
  return meta;
}

/**
 * The hot path (500 students saving every ~20 s): one round trip. The guard (own attempt, in progress, strictly
 * `now < deadlineAt`) and the upsert are one statement, so there is no gap between check and write (EXAM-03).
 */
export async function saveAnswer(studentId: string, attemptId: string, examQuestionId: string, selected: string[], marked: boolean, at: Date = now()) {
  const meta = await questionMeta(examQuestionId);
  if (!meta) throw new AppError('NOT_FOUND', 404, 'Question not found.');
  const unique = [...new Set(selected)];
  if (unique.some((o) => !meta.optionIds.has(o))) throw new AppError('VALIDATION_ERROR', 400, 'That option does not belong to this question.', { selectedOptionIds: 'Unknown option' });
  if (meta.type === 'single' && unique.length > 1) throw new AppError('VALIDATION_ERROR', 400, 'Choose only one option.', { selectedOptionIds: 'Only one allowed' });
  const rows = await prisma.$queryRaw<{ saved: number }[]>(Prisma.sql`
    WITH a AS (
      SELECT id FROM exam_attempts
      WHERE id = ${attemptId} AND student_id = ${studentId} AND exam_id = ${meta.examId} AND status = 'in_progress' AND deadline_at > ${at}::timestamptz
    ), ins AS (
      INSERT INTO answers (attempt_id, exam_question_id, selected_option_ids, marked_for_review, updated_at)
      SELECT a.id, ${examQuestionId}, ${unique}::text[], ${marked}, ${at}::timestamptz FROM a
      ON CONFLICT (attempt_id, exam_question_id) DO UPDATE
        SET selected_option_ids = EXCLUDED.selected_option_ids, marked_for_review = EXCLUDED.marked_for_review, updated_at = EXCLUDED.updated_at
      RETURNING 1
    )
    SELECT count(*)::int AS saved FROM ins`);
  if (rows[0]?.saved === 1) return;
  // Not saved: find out why (the slow path is fine, it is rare).
  const a = await prisma.examAttempt.findFirst({ where: { id: attemptId, studentId }, select: { id: true, examId: true, status: true, deadlineAt: true } });
  if (!a || a.examId !== meta.examId) throw new AppError('NOT_FOUND', 404, 'Attempt not found.');
  if (a.status === 'in_progress') await finaliseIfExpired(a, at);
  throw new AppError('DEADLINE_PASSED', 409, a.status === 'in_progress' || at >= a.deadlineAt ? 'Time is up. This answer was not saved.' : 'This attempt is already submitted.');
}

attemptsRouter.put('/:id/answers/:examQuestionId', student, validate({ params: z.object({ id, examQuestionId: id }), body: answerBody }), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof answerBody>;
  await saveAnswer(me(req), req.params.id as string, req.params.examQuestionId as string, b.selectedOptionIds, b.markedForReview);
  res.json({ saved: true, serverNow: now() });
}));

attemptsRouter.post('/:id/integrity', student, idParam, validate({ body: integrityBody }), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof integrityBody>;
  const events = b.events.map((e) => ({ type: e.type, t: e.at.toISOString() }));
  // Append and keep at most 500 entries, atomically and only while the attempt is running.
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE exam_attempts SET integrity_log = jsonb_path_query_array(integrity_log || ${JSON.stringify(events)}::jsonb, ${`$[0 to ${INTEGRITY_CAP - 1}]`}::jsonpath)
    WHERE id = ${req.params.id as string} AND student_id = ${me(req)} AND status = 'in_progress'`);
  if (n === 0) {
    const a = await prisma.examAttempt.findFirst({ where: { id: req.params.id as string, studentId: me(req) }, select: { id: true } });
    if (!a) throw new AppError('NOT_FOUND', 404, 'Attempt not found.');
  }
  res.json({ ok: true });
}));

/** Submit (idempotent): inside the 5 s grace it counts as a student submit; later it is finished as an auto-submit. */
export async function submitAttempt(studentId: string, attemptId: string, at: Date = now()) {
  const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, studentId } });
  if (!attempt) throw new AppError('NOT_FOUND', 404, 'Attempt not found.');
  if (attempt.status === 'in_progress') {
    const inGrace = at.getTime() < attempt.deadlineAt.getTime() + SUBMIT_GRACE_SECONDS * 1000;
    await finaliseAttempt(attempt.id, inGrace ? 'manual' : 'deadline', undefined, at);
    await ensureRevealed(attempt.examId, at);
  }
  const [fresh, exam] = await Promise.all([
    prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
    prisma.exam.findUniqueOrThrow({ where: { id: attempt.examId } }),
  ]);
  return resultView(exam, fresh);
}

attemptsRouter.post('/:id/submit', student, idParam, asyncHandler(async (req, res) => {
  res.json(await submitAttempt(me(req), req.params.id as string));
}));
