import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { now as clockNow } from '../../lib/clock';
import { type GradedItem, grade } from './logic';

type Tx = Prisma.TransactionClient;
export type FinaliseReason = 'passed_out' | 'deadline' | 'manual';
export interface FinaliseResult {
  status: 'in_progress' | 'submitted' | 'auto_submitted';
  score: number | null;
  submittedAt: Date | null;
  /** True when this call did the finalising (false when the attempt was already finished). */
  changed: boolean;
}

/** Writes `isCorrect/marksAwarded` for every question (creating empty answers for unanswered ones). */
export async function writeGrades(tx: Tx, attemptId: string, items: GradedItem[]): Promise<void> {
  if (items.length === 0) return;
  const existing = await tx.answer.findMany({ where: { attemptId }, select: { examQuestionId: true } });
  const have = new Set(existing.map((a) => a.examQuestionId));
  const missing = items.filter((i) => !have.has(i.examQuestionId));
  if (missing.length) {
    await tx.answer.createMany({
      data: missing.map((i) => ({ attemptId, examQuestionId: i.examQuestionId, selectedOptionIds: [], isCorrect: i.isCorrect, marksAwarded: i.marksAwarded })),
      skipDuplicates: true,
    });
  }
  await tx.$executeRaw(Prisma.sql`
    UPDATE answers a SET is_correct = v.c, marks_awarded = v.m
    FROM unnest(${items.map((i) => i.examQuestionId)}::text[], ${items.map((i) => i.isCorrect)}::boolean[], ${items.map((i) => i.marksAwarded)}::numeric[]) AS v(q, c, m)
    WHERE a.attempt_id = ${attemptId} AND a.exam_question_id = v.q`);
}

/** Grades the saved answers against the current key (server only) and returns the score. */
export async function gradeAttempt(tx: Tx, attemptId: string, examId: string): Promise<number> {
  const [questions, answers] = await Promise.all([
    tx.examQuestion.findMany({ where: { examId }, select: { id: true, marks: true, correct: true, isCancelled: true } }),
    tx.answer.findMany({ where: { attemptId }, select: { examQuestionId: true, selectedOptionIds: true } }),
  ]);
  const { score, items } = grade(
    questions.map((q) => ({ id: q.id, marks: Number(q.marks), correct: q.correct as string[], isCancelled: q.isCancelled })),
    answers,
  );
  await writeGrades(tx, attemptId, items);
  return score;
}

/**
 * Finishes one in-progress attempt exactly like a student submit (05 §4.2, §5). Idempotent: an attempt that is
 * already finished is returned unchanged. The attempt row is locked so a submit and the auto-submit job never
 * both grade. `deadline` and `passed_out` give `auto_submitted`; `manual` gives `submitted`.
 */
export async function finaliseAttempt(attemptId: string, reason: FinaliseReason, tx?: Tx, at: Date = clockNow()): Promise<FinaliseResult | null> {
  const run = async (db: Tx): Promise<FinaliseResult | null> => {
    const rows = await db.$queryRaw<{ id: string; status: FinaliseResult['status']; exam_id: string; deadline_at: Date; submitted_at: Date | null; score: Prisma.Decimal | null }[]>(
      Prisma.sql`SELECT id, status, exam_id, deadline_at, submitted_at, score FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`,
    );
    const a = rows[0];
    if (!a) return null;
    if (a.status !== 'in_progress') return { status: a.status, score: a.score === null ? null : Number(a.score), submittedAt: a.submitted_at, changed: false };
    const score = await gradeAttempt(db, attemptId, a.exam_id);
    const status = reason === 'manual' ? 'submitted' : 'auto_submitted';
    const submittedAt = reason === 'passed_out' ? at : new Date(Math.min(at.getTime(), a.deadline_at.getTime()));
    await db.examAttempt.update({ where: { id: attemptId }, data: { status, submittedAt, score } });
    return { status, score, submittedAt, changed: true };
  };
  return tx ? run(tx) : prisma.$transaction(run, { timeout: 20_000 });
}

/** Lazy finalise (05 §4.2): any read or write that meets an expired in-progress attempt finishes it. */
export async function finaliseIfExpired(attempt: { id: string; status: string; deadlineAt: Date }, at: Date = clockNow()): Promise<boolean> {
  if (attempt.status !== 'in_progress' || at < attempt.deadlineAt) return false;
  const r = await finaliseAttempt(attempt.id, 'deadline', undefined, at);
  return !!r?.changed;
}

/** Boot/job sweep: finishes every in-progress attempt whose deadline has passed. */
export async function finaliseExpiredAttempts(at: Date = clockNow(), limit = 500): Promise<number> {
  const rows = await prisma.examAttempt.findMany({ where: { status: 'in_progress', deadlineAt: { lte: at } }, select: { id: true }, take: limit });
  let n = 0;
  for (const r of rows) if ((await finaliseAttempt(r.id, 'deadline', undefined, at))?.changed) n++;
  return n;
}

/** True when the student has an exam attempt running with time left (05 §4.2); the AI chat (09) blocks on this. */
export async function hasLiveAttempt(studentId: string, at: Date = clockNow()): Promise<boolean> {
  return !!(await prisma.examAttempt.findFirst({ where: { studentId, status: 'in_progress', deadlineAt: { gt: at } }, select: { id: true } }));
}
