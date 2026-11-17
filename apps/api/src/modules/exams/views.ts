import { Prisma } from '@prisma/client';
import type { Exam, ExamAttempt } from '@prisma/client';
import { prisma } from '../../db';
import { now as clockNow } from '../../lib/clock';
import { AppError } from '../../lib/http';
import { decodeCursor, paginate } from '../../lib/pagination';
import { offeringContext, offeringContexts } from './context';
import { finaliseIfExpired } from './finalise';
import { gradeFor, percent, studentVisibility, type Visibility } from './logic';
import { bestAttempts, gradeScale, standingsFor } from './ranks';
import { ensureRevealed, revealDue } from './reveal';

/**
 * The one place student payloads are built (05 §4.3, EXAM-06/07). Questions are read through STUDENT_QUESTION
 * (an explicit select with no `correct`); the key is read separately and only when `Visibility.showCorrect`.
 */
export const STUDENT_QUESTION = { id: true, order: true, type: true, text: true, options: true, marks: true, chapterId: true } as const;
type Opt = { id: string; text: string };
type OrderEntry = { q: string; o: string[] };

export const visibilityOf = (exam: Exam, attemptStatus: ExamAttempt['status']): Visibility =>
  studentVisibility({
    resultMode: exam.resultMode, revealed: !!exam.revealedAt, resultsPublished: !!exam.resultsPublishedAt,
    showAnswersAfterEnd: exam.showAnswersAfterEnd, attemptStatus,
  });

const num = (d: Prisma.Decimal | number | null): number | null => (d === null ? null : Number(d));

/** What the student sees of one finished attempt, limited by the visibility table. */
export async function resultView(exam: Exam, attempt: ExamAttempt) {
  const vis = visibilityOf(exam, attempt.status);
  const total = Number(exam.totalMarks);
  const base = {
    ...(await offeringContext(exam.courseOfferingId)),
    id: attempt.id, examId: exam.id, attemptNo: attempt.attemptNo, status: attempt.status, submittedAt: attempt.submittedAt,
    state: vis.state, resultPending: vis.state === 'pending', totalMarks: total,
  };
  if (!vis.showScore) return base;
  const score = num(attempt.score) ?? 0;
  const pct = percent(score, total);
  const scale = await gradeScale();
  const out: Record<string, unknown> = {
    ...base, score, percentage: pct, grade: gradeFor(pct, scale), passMarks: Number(exam.passMarks), passed: score >= Number(exam.passMarks),
  };
  if (vis.showRanks) {
    const standing = standingsFor(await bestAttempts([exam.id]), total).get(attempt.studentId);
    if (standing) out.rank = { rank: standing.rank, of: standing.of, sectionAverage: standing.sectionAverage };
  }
  if (vis.showPerQuestion) {
    const [questions, answers] = await Promise.all([
      prisma.examQuestion.findMany({ where: { examId: exam.id }, select: { ...STUDENT_QUESTION, isCancelled: true } }),
      prisma.answer.findMany({ where: { attemptId: attempt.id } }),
    ]);
    const ans = new Map(answers.map((a) => [a.examQuestionId, a]));
    const key = vis.showCorrect ? new Map((await prisma.examQuestion.findMany({ where: { examId: exam.id }, select: { id: true, correct: true } })).map((q) => [q.id, q.correct as string[]])) : null;
    const order = (attempt.questionOrder as unknown as OrderEntry[]) ?? [];
    const byId = new Map(questions.map((q) => [q.id, q]));
    out.questions = order.flatMap((o) => {
      const q = byId.get(o.q);
      if (!q) return [];
      const opts = q.options as Opt[];
      const a = ans.get(q.id);
      return [{
        id: q.id, type: q.type, text: q.text, marks: Number(q.marks), chapterId: q.chapterId, isCancelled: q.isCancelled,
        options: o.o.map((oid) => opts.find((x) => x.id === oid)).filter((x): x is Opt => !!x),
        selectedOptionIds: a?.selectedOptionIds ?? [], isCorrect: a?.isCorrect ?? false, marksAwarded: num(a?.marksAwarded ?? 0),
        ...(key ? { correct: key.get(q.id) ?? [] } : {}),
      }];
    });
  }
  return out;
}

/** The attempt as the student takes it: questions in the stored order, saved answers, deadline and the server clock. */
export async function takingView(exam: Exam, attempt: ExamAttempt) {
  const questions = await prisma.examQuestion.findMany({ where: { examId: exam.id }, select: STUDENT_QUESTION });
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers = await prisma.answer.findMany({ where: { attemptId: attempt.id }, select: { examQuestionId: true, selectedOptionIds: true, markedForReview: true } });
  const order = attempt.questionOrder as unknown as OrderEntry[];
  return {
    ...(await offeringContext(exam.courseOfferingId)),
    id: attempt.id, examId: exam.id, attemptNo: attempt.attemptNo, status: attempt.status, startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt, serverNow: clockNow(), title: exam.title, totalMarks: Number(exam.totalMarks),
    questions: order.flatMap((o) => {
      const q = byId.get(o.q);
      if (!q) return [];
      const opts = q.options as Opt[];
      return [{
        id: q.id, type: q.type, text: q.text, marks: Number(q.marks),
        options: o.o.map((oid) => opts.find((x) => x.id === oid)).filter((x): x is Opt => !!x),
      }];
    }),
    answers: answers.map((a) => ({ examQuestionId: a.examQuestionId, selectedOptionIds: a.selectedOptionIds, markedForReview: a.markedForReview })),
  };
}

/** GET /attempts/:id — own attempt only; an expired in-progress attempt is finished on the spot. */
export async function attemptPayload(attemptId: string, studentId: string) {
  let attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, studentId } });
  if (!attempt) throw new AppError('NOT_FOUND', 404, 'Attempt not found.');
  if (await finaliseIfExpired(attempt)) attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  await ensureRevealed(attempt.examId);
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: attempt.examId } });
  return attempt.status === 'in_progress' ? takingView(exam, attempt) : resultView(exam, attempt);
}

/** GET /exams/:id as a student: window, limits and own attempts. Never any question (EXAM-07). */
export async function studentExamSummary(studentId: string, examId: string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  const enrolled = exam && exam.status !== 'draft' && (await prisma.enrollment.findFirst({ where: { studentId, courseOfferingId: exam.courseOfferingId, status: 'active' }, select: { id: true } }));
  if (!exam || !enrolled) throw new AppError('NOT_FOUND', 404, 'Exam not found.');
  await ensureRevealed(exam.id);
  const fresh = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
  let attempts = await prisma.examAttempt.findMany({ where: { examId, studentId }, orderBy: { attemptNo: 'asc' } });
  for (const a of attempts) await finaliseIfExpired(a);
  attempts = await prisma.examAttempt.findMany({ where: { examId, studentId }, orderBy: { attemptNo: 'asc' } });
  const at = clockNow();
  const live = attempts.find((a) => a.status === 'in_progress');
  return {
    ...(await offeringContext(fresh.courseOfferingId)),
    id: fresh.id, kind: fresh.kind, title: fresh.title, instructions: fresh.instructions, startAt: fresh.startAt, endAt: fresh.endAt,
    durationMin: fresh.durationMin, totalMarks: Number(fresh.totalMarks), passMarks: Number(fresh.passMarks), maxAttempts: fresh.maxAttempts,
    resultMode: fresh.resultMode, status: fresh.status, serverNow: at,
    attemptsUsed: attempts.length,
    canStart: !live && fresh.status === 'published' && at >= fresh.startAt && at < fresh.endAt && (fresh.maxAttempts === 0 || attempts.length < fresh.maxAttempts),
    inProgressAttemptId: live?.id ?? null,
    attempts: await Promise.all(attempts.map(async (a) => (a.status === 'in_progress' ? { id: a.id, attemptNo: a.attemptNo, status: a.status, deadlineAt: a.deadlineAt } : resultView(fresh, a)))),
  };
}

/** GET /exams/me — exams of the student's own courses with countdown data. */
export async function myExams(studentId: string, q: { status?: 'upcoming' | 'live' | 'completed'; cursor?: string; limit: number }) {
  const at = clockNow();
  const cur = decodeCursor(q.cursor);
  const running = { attempts: { some: { studentId, status: 'in_progress' as const } } };
  const phase: Prisma.ExamWhereInput =
    q.status === 'upcoming' ? { startAt: { gt: at } }
    : q.status === 'live' ? { OR: [{ startAt: { lte: at }, endAt: { gt: at } }, running] }
    : q.status === 'completed' ? { endAt: { lte: at }, NOT: running }
    : {};
  const rows = await prisma.exam.findMany({
    where: {
      status: { in: ['published', 'closed'] }, courseOffering: { enrollments: { some: { studentId, status: 'active' } } }, ...phase,
      ...(cur ? { AND: [{ OR: [{ createdAt: { lt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { lt: cur.id } }] }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const { items, nextCursor } = paginate(rows, q.limit);
  await revealDue(items);
  const ctx = await offeringContexts(items.map((e) => e.courseOfferingId));
  const mine = await prisma.examAttempt.findMany({ where: { studentId, examId: { in: items.map((e) => e.id) } }, select: { examId: true, id: true, status: true, deadlineAt: true } });
  return {
    serverNow: at,
    nextCursor,
    items: items.map((e) => {
      const a = mine.filter((m) => m.examId === e.id);
      const live = a.find((m) => m.status === 'in_progress');
      return {
        ...ctx.get(e.courseOfferingId), id: e.id, offeringId: e.courseOfferingId, kind: e.kind, title: e.title, startAt: e.startAt, endAt: e.endAt,
        durationMin: e.durationMin, totalMarks: Number(e.totalMarks), maxAttempts: e.maxAttempts, status: e.status, resultMode: e.resultMode,
        phase: live || (at >= e.startAt && at < e.endAt) ? 'live' : at < e.startAt ? 'upcoming' : 'completed',
        msToStart: Math.max(0, e.startAt.getTime() - at.getTime()), msToEnd: Math.max(0, e.endAt.getTime() - at.getTime()),
        attemptsUsed: a.length, inProgressAttempt: live ? { id: live.id, deadlineAt: live.deadlineAt } : null,
      };
    }),
  };
}
