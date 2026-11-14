import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type Exam, type Question } from '@prisma/client';
import { WEEKDAYS, examCreateBody, examListQuery, examPatchBody, examQuestionsBody, id } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { notify } from '../../lib/notify';
import { decodeCursor, paginate } from '../../lib/pagination';
import { dhakaDate, toUtc, weekdayOf } from '../../lib/time';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { type ExamWithOffering, examForOwner, examForViewer } from './access';
import { type Opt, createQuestion } from './bank';
import { ensureRevealed, enrolledStudentIds } from './reveal';
import { scheduleExamJobs } from './schedule';
import { studentExamSummary } from './views';

/** Exam lifecycle (05 §3): draft → published → closed. Routes are mounted at /api/exams after the fixed paths. */
export const lifecycleRouter = Router();
const idParam = validate({ params: z.object({ id }) });
const user = (req: unknown) => (req as AuthedRequest).user;
type Body<T extends z.ZodTypeAny> = z.infer<T>;

/** "Do not hold exams in the maintenance window" (PRD §8): a warning, never a block. */
export async function maintenanceWarnings(startAt: Date, endAt: Date): Promise<string[]> {
  const s = await prisma.setting.findUnique({ where: { key: 'maintenance_window' } });
  const w = s?.value as { day?: string; from?: string; to?: string } | null | undefined;
  if (!w?.day || !w.from || !w.to) return [];
  let d = dhakaDate(startAt);
  const last = dhakaDate(endAt);
  for (let i = 0; i < 15 && d <= last; i++) {
    if (WEEKDAYS[weekdayOf(d)] === w.day.toLowerCase().slice(0, 3)) {
      if (toUtc(d, w.from) < endAt && toUtc(d, w.to) > startAt) return ['MAINTENANCE_WINDOW_OVERLAP'];
    }
    d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  }
  return [];
}

const numberOf = (d: Prisma.Decimal | number | null | undefined): number => (d === null || d === undefined ? 0 : Number(d));

async function sumMarks(examId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  return numberOf((await db.examQuestion.aggregate({ where: { examId }, _sum: { marks: true } }))._sum.marks);
}

export function examView(e: Exam, totalMarks = numberOf(e.totalMarks)) {
  return {
    id: e.id, offeringId: e.courseOfferingId, kind: e.kind, title: e.title, instructions: e.instructions,
    startAt: e.startAt, endAt: e.endAt, durationMin: e.durationMin, totalMarks, passMarks: numberOf(e.passMarks),
    maxAttempts: e.maxAttempts, shuffleQuestions: e.shuffleQuestions, shuffleOptions: e.shuffleOptions,
    showAnswersAfterEnd: e.showAnswersAfterEnd, resultMode: e.resultMode, status: e.status, publishedAt: e.publishedAt,
    resultsPublishedAt: e.resultsPublishedAt, revealedAt: e.revealedAt, createdAt: e.createdAt,
  };
}

/** Teacher view of one exam, including the snapshot questions and their correct answers. */
async function teacherDetail(e: Exam, hideKey = false) {
  const questions = await prisma.examQuestion.findMany({ where: { examId: e.id }, orderBy: { order: 'asc' } });
  const total = e.status === 'draft' ? questions.reduce((s, q) => s + Number(q.marks), 0) : numberOf(e.totalMarks);
  return {
    ...examView(e, total),
    questions: questions.map((q) => ({
      id: q.id, order: q.order, questionId: q.questionId, type: q.type, text: q.text, options: q.options as Opt[],
      correct: hideKey ? null : (q.correct as string[]), marks: Number(q.marks), chapterId: q.chapterId, isCancelled: q.isCancelled,
    })),
  };
}

// ───── create / list / read ─────
lifecycleRouter.post('/', requireRole('teacher'), validate({ body: examCreateBody }), asyncHandler(async (req, res) => {
  const b = req.body as Body<typeof examCreateBody>;
  const offering = await prisma.courseOffering.findUnique({ where: { id: b.offeringId } });
  if (!offering || offering.endedAt || offering.teacherId !== user(req).id) throw new AppError('NOT_FOUND', 404, 'Course not found.');
  if (b.startAt <= now()) throw new AppError('VALIDATION_ERROR', 400, 'Start must be in the future.', { startAt: 'Must be in the future' });
  const e = await prisma.exam.create({
    data: {
      courseOfferingId: offering.id, createdBy: user(req).id, kind: b.kind, title: b.title, instructions: b.instructions ?? null,
      startAt: b.startAt, endAt: b.endAt, durationMin: b.durationMin, passMarks: b.passMarks,
      // Draft has no questions yet; the column must satisfy pass_marks <= total_marks, so it holds the larger until publish sets the real total.
      totalMarks: b.passMarks, maxAttempts: b.maxAttempts, shuffleQuestions: b.shuffleQuestions,
      shuffleOptions: b.shuffleOptions, showAnswersAfterEnd: b.showAnswersAfterEnd, resultMode: b.resultMode,
    },
  });
  res.status(201).json({ ...examView(e, 0), warnings: await maintenanceWarnings(e.startAt, e.endAt) });
}));

lifecycleRouter.get('/', validate({ query: examListQuery }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as Body<typeof examListQuery>;
  const r = req as AuthedRequest;
  if (r.actor.role === 'student') throw new AppError('FORBIDDEN', 403, 'Use /api/exams/me.');
  const off = await prisma.courseOffering.findUnique({ where: { id: q.offeringId }, select: { teacherId: true, sectionId: true } });
  const allowed =
    !!off && (r.actor.role === 'admin' || off.teacherId === r.user.id || (await prisma.section.findFirst({ where: { id: off.sectionId, mentorTeacherId: r.user.id }, select: { id: true } })));
  if (!allowed) throw new AppError('NOT_FOUND', 404, 'Course not found.');
  const cur = decodeCursor(q.cursor);
  const rows = await prisma.exam.findMany({
    where: {
      courseOfferingId: q.offeringId,
      // another teacher's drafts are theirs alone; the Admin and a mentor see only published exams
      ...(off.teacherId === r.user.id ? {} : { status: { not: 'draft' as const } }),
      ...(cur ? { OR: [{ createdAt: { lt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { lt: cur.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const { items, nextCursor } = paginate(rows, q.limit);
  res.json({ items: items.map((e) => examView(e)), nextCursor });
}));

lifecycleRouter.get('/:id', idParam, asyncHandler(async (req, res) => {
  const r = req as AuthedRequest;
  if (r.actor.role === 'student') return void res.json(await studentExamSummary(r.user.id, req.params.id as string));
  const exam = await examForViewer(req, req.params.id as string);
  if (exam.status === 'draft' && exam.courseOffering.teacherId !== r.user.id) throw new AppError('NOT_FOUND', 404, 'Exam not found.');
  await ensureRevealed(exam.id);
  const fresh = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
  // Mentors and the Admin see the answer key only after the window has ended.
  const hideKey = exam.courseOffering.teacherId !== r.user.id && fresh.endAt > now();
  res.json(await teacherDetail(fresh, hideKey));
}));

// ───── questions (draft, or published before start) ─────
type Item = Body<typeof examQuestionsBody>['items'][number];

/** Copies the chosen questions into ExamQuestion rows, replacing any earlier copy (the snapshot). Returns Σ marks. */
async function writeSnapshot(tx: Prisma.TransactionClient, exam: ExamWithOffering, teacherId: string, items: Item[]): Promise<number> {
  if ((await tx.examAttempt.count({ where: { examId: exam.id } })) > 0) throw new AppError('EXAM_LOCKED', 409, 'This exam has started and can no longer be edited.');
  const ids = items.flatMap((i) => ('questionId' in i ? [i.questionId] : []));
  if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_ERROR', 400, 'A question is listed twice.', { items: 'Duplicate question' });
  const found = new Map<string, Question>(
    (await tx.question.findMany({ where: { id: { in: ids }, teacherId, courseId: exam.courseOffering.courseId, archivedAt: null } })).map((q) => [q.id, q]),
  );
  const questions: Question[] = [];
  for (const it of items) {
    if ('questionId' in it) {
      const q = found.get(it.questionId);
      if (!q) throw new AppError('VALIDATION_ERROR', 400, 'A question is not in your bank for this course.', { items: 'Unknown question' });
      questions.push(q);
    } else {
      if (it.inline.chapterId && !(await tx.chapter.findFirst({ where: { id: it.inline.chapterId, courseId: exam.courseOffering.courseId }, select: { id: true } }))) {
        throw new AppError('VALIDATION_ERROR', 400, 'Chapter not found in this course.', { items: 'Unknown chapter' });
      }
      questions.push(await createQuestion(teacherId, { ...it.inline, courseId: exam.courseOffering.courseId }, tx));
    }
  }
  await tx.examQuestion.deleteMany({ where: { examId: exam.id } });
  await tx.examQuestion.createMany({
    data: questions.map((q, i) => ({
      examId: exam.id, questionId: q.id, order: i + 1, type: q.type, text: q.text, options: q.options as Prisma.InputJsonValue,
      correct: q.correct as Prisma.InputJsonValue, marks: q.marks, chapterId: q.chapterId,
    })),
  });
  return questions.reduce((s, q) => s + Number(q.marks), 0);
}

/** Re-reads every source question so edits made in the bank before publishing are in the snapshot. */
async function refreshSnapshot(tx: Prisma.TransactionClient, examId: string): Promise<void> {
  const rows = await tx.examQuestion.findMany({ where: { examId }, include: { question: true } });
  for (const r of rows) {
    const q = r.question;
    if (!q || q.archivedAt) continue;
    await tx.examQuestion.update({
      where: { id: r.id },
      data: { type: q.type, text: q.text, options: q.options as Prisma.InputJsonValue, correct: q.correct as Prisma.InputJsonValue, marks: q.marks, chapterId: q.chapterId },
    });
  }
}

const mustBeEditable = (e: Exam, at: Date): void => {
  if (e.status === 'draft') return;
  if (e.status === 'published' && at < e.startAt) return;
  throw new AppError('EXAM_LOCKED', 409, 'This exam has started and can no longer be edited. You can still fix an answer key or cancel a question.');
};

async function applyQuestions(exam: ExamWithOffering, teacherId: string, items: Item[]) {
  return prisma.$transaction(async (tx) => {
    const total = await writeSnapshot(tx, exam, teacherId, items);
    if (exam.status === 'published') {
      if (Number(exam.passMarks) > total) throw new AppError('VALIDATION_ERROR', 400, 'Pass marks are higher than the total marks.', { passMarks: 'Above total marks' });
      await tx.exam.update({ where: { id: exam.id }, data: { totalMarks: total } });
    } else {
      await tx.exam.update({ where: { id: exam.id }, data: { totalMarks: Math.max(total, Number(exam.passMarks)) } });
    }
    return total;
  });
}

lifecycleRouter.put('/:id/questions', idParam, validate({ body: examQuestionsBody }), asyncHandler(async (req, res) => {
  const exam = await examForOwner(req, req.params.id as string);
  mustBeEditable(exam, now());
  await applyQuestions(exam, user(req).id, (req.body as Body<typeof examQuestionsBody>).items);
  res.json(await teacherDetail(await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } })));
}));

// ───── publish ─────
lifecycleRouter.post('/:id/publish', idParam, asyncHandler(async (req, res) => {
  const at = now();
  const exam = await examForOwner(req, req.params.id as string);
  if (exam.status !== 'draft') throw new AppError('CONFLICT', 409, 'This exam is already published.');
  if (exam.startAt <= at) throw new AppError('VALIDATION_ERROR', 400, 'Start must be in the future. Change the start time first.', { startAt: 'Must be in the future' });
  const published = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM exams WHERE id = ${exam.id} FOR UPDATE`);
    const fresh = await tx.exam.findUniqueOrThrow({ where: { id: exam.id } });
    if (fresh.status !== 'draft') throw new AppError('CONFLICT', 409, 'This exam is already published.');
    if ((await tx.examQuestion.count({ where: { examId: exam.id } })) < 1) throw new AppError('VALIDATION_ERROR', 400, 'Add at least one question.', { items: 'No questions' });
    await refreshSnapshot(tx, exam.id);
    const total = await sumMarks(exam.id, tx);
    if (Number(fresh.passMarks) > total) throw new AppError('VALIDATION_ERROR', 400, 'Pass marks are higher than the total marks.', { passMarks: 'Above total marks' });
    return tx.exam.update({ where: { id: exam.id }, data: { status: 'published', publishedAt: at, totalMarks: total } });
  });
  await notify(await enrolledStudentIds(exam.courseOfferingId), 'exam_published', { type: 'exam', id: exam.id }, `New ${published.kind}: "${published.title}".`);
  await scheduleExamJobs(published);
  res.json({ ...examView(published), warnings: await maintenanceWarnings(published.startAt, published.endAt) });
}));

// ───── patch / delete ─────
lifecycleRouter.patch('/:id', idParam, validate({ body: examPatchBody }), asyncHandler(async (req, res) => {
  const at = now();
  const exam = await examForOwner(req, req.params.id as string);
  mustBeEditable(exam, at);
  const { items, ...b } = req.body as Body<typeof examPatchBody>;
  const kind = b.kind ?? exam.kind;
  const maxAttempts = b.maxAttempts ?? (kind === 'exam' ? 1 : exam.maxAttempts);
  const startAt = b.startAt ?? exam.startAt;
  const endAt = b.endAt ?? exam.endAt;
  const passMarks = b.passMarks ?? Number(exam.passMarks);
  const fields: Record<string, string> = {};
  if (endAt <= startAt) fields.endAt = 'End must be after start';
  if (kind === 'exam' && maxAttempts !== 1) fields.maxAttempts = 'An exam allows exactly 1 attempt';
  if ((b.startAt || exam.status === 'published') && startAt <= at) fields.startAt = 'Must be in the future';
  if (Object.keys(fields).length) throw new AppError('VALIDATION_ERROR', 400, 'Some fields are invalid.', fields);
  const updated = await prisma.$transaction(async (tx) => {
    let total = exam.status === 'published' ? Number(exam.totalMarks) : await sumMarks(exam.id, tx);
    if (items) total = await writeSnapshot(tx, exam, user(req).id, items);
    if (exam.status === 'published' && passMarks > total) throw new AppError('VALIDATION_ERROR', 400, 'Pass marks are higher than the total marks.', { passMarks: 'Above total marks' });
    return tx.exam.update({
      where: { id: exam.id },
      data: {
        kind, maxAttempts, startAt, endAt, passMarks,
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.instructions !== undefined ? { instructions: b.instructions } : {}),
        ...(b.durationMin !== undefined ? { durationMin: b.durationMin } : {}),
        ...(b.shuffleQuestions !== undefined ? { shuffleQuestions: b.shuffleQuestions } : {}),
        ...(b.shuffleOptions !== undefined ? { shuffleOptions: b.shuffleOptions } : {}),
        ...(b.showAnswersAfterEnd !== undefined ? { showAnswersAfterEnd: b.showAnswersAfterEnd } : {}),
        ...(b.resultMode !== undefined ? { resultMode: b.resultMode } : {}),
        totalMarks: exam.status === 'published' ? total : Math.max(total, passMarks),
      },
    });
  });
  if (updated.status === 'published' && (+updated.startAt !== +exam.startAt || +updated.endAt !== +exam.endAt)) await scheduleExamJobs(updated);
  res.json({ ...(await teacherDetail(updated)), warnings: await maintenanceWarnings(updated.startAt, updated.endAt) });
}));

lifecycleRouter.delete('/:id', idParam, asyncHandler(async (req, res) => {
  const exam = await examForOwner(req, req.params.id as string);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM exams WHERE id = ${exam.id} FOR UPDATE`);
    const fresh = await tx.exam.findUniqueOrThrow({ where: { id: exam.id } });
    const attempts = await tx.examAttempt.count({ where: { examId: exam.id } });
    const ok = fresh.status === 'draft' || (fresh.status === 'published' && attempts === 0 && now() < fresh.startAt);
    if (!ok || attempts > 0) throw new AppError('EXAM_LOCKED', 409, 'This exam has started and cannot be deleted.');
    await tx.exam.delete({ where: { id: exam.id } }); // its question copies go with it
  });
  res.json({ ok: true });
}));

// ───── publish results (manual mode) ─────
lifecycleRouter.post('/:id/publish-results', idParam, asyncHandler(async (req, res) => {
  const exam = await examForOwner(req, req.params.id as string);
  if (exam.status === 'draft') throw new AppError('CONFLICT', 409, 'This exam is not published.');
  if (!(await ensureRevealed(exam.id))) throw new AppError('CONFLICT', 409, 'Results can be published after the exam window has ended and every attempt is finished.');
  const r = await prisma.exam.updateMany({ where: { id: exam.id, resultsPublishedAt: null }, data: { resultsPublishedAt: now() } });
  if (r.count === 1) await notify(await enrolledStudentIds(exam.courseOfferingId), 'result_published', { type: 'exam', id: exam.id }, `Results of "${exam.title}" are out.`);
  res.json(examView(await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } })));
}));
