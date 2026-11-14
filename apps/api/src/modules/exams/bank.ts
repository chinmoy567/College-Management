import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { Prisma, Question } from '@prisma/client';
import { OPTION_MAX, bankQuery, checkQuestionShape, id, marksSchema, questionBody, questionPatchBody } from '@cms/shared';
import { prisma } from '../../db';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { decodeCursor, paginate } from '../../lib/pagination';
import { type AuthedRequest, requireRole } from '../../middleware/session';

/** Question bank (05 §2): the teacher's own text MCQs, for courses they teach. */
export const bankRouter = Router();
bankRouter.use(requireRole('teacher'));
const me = (req: unknown) => (req as AuthedRequest).user.id;

export type Opt = { id: string; text: string };
export const optionList = (texts: { text: string }[]): Opt[] => texts.map((o, i) => ({ id: `o${i + 1}`, text: o.text }));
export const correctIds = (idx: number[]): string[] => [...idx].sort((a, b) => a - b).map((i) => `o${i + 1}`);

/** The teacher teaches an active offering of the course. */
export async function assertTeachesCourse(teacherId: string, courseId: string): Promise<void> {
  const ok = await prisma.courseOffering.findFirst({ where: { teacherId, courseId, endedAt: null }, select: { id: true } });
  if (!ok) throw new AppError('FORBIDDEN', 403, 'You do not teach this course.');
}

async function assertChapter(courseId: string, chapterId: string | null | undefined): Promise<void> {
  if (!chapterId) return;
  if (!(await prisma.chapter.findFirst({ where: { id: chapterId, courseId }, select: { id: true } }))) {
    throw new AppError('VALIDATION_ERROR', 400, 'Chapter not found in this course.', { chapterId: 'Not in this course' });
  }
}

export const questionView = (q: Question) => ({
  id: q.id, courseId: q.courseId, chapterId: q.chapterId, type: q.type, text: q.text,
  options: q.options as Opt[], correct: q.correct as string[], marks: Number(q.marks), createdAt: q.createdAt,
});

/** Creates a bank question for a teacher (also used for inline questions in an exam). */
export async function createQuestion(teacherId: string, b: z.infer<typeof questionBody>, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.question.create({
    data: {
      teacherId, courseId: b.courseId, chapterId: b.chapterId ?? null, type: b.type, text: b.text,
      options: optionList(b.options), correct: correctIds(b.correct), marks: b.marks,
    },
  });
}

bankRouter.get('/', validate({ query: bankQuery }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof bankQuery>;
  await assertTeachesCourse(me(req), q.courseId);
  const cur = decodeCursor(q.cursor);
  const rows = await prisma.question.findMany({
    where: {
      teacherId: me(req), courseId: q.courseId, archivedAt: null,
      ...(q.chapterId ? { chapterId: q.chapterId } : {}),
      ...(q.q ? { text: { contains: q.q, mode: 'insensitive' } } : {}),
      ...(cur ? { OR: [{ createdAt: { lt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { lt: cur.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const { items, nextCursor } = paginate(rows, q.limit);
  res.json({ items: items.map(questionView), nextCursor });
}));

bankRouter.post('/', validate({ body: questionBody }), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof questionBody>;
  await assertTeachesCourse(me(req), b.courseId);
  await assertChapter(b.courseId, b.chapterId);
  res.status(201).json(questionView(await createQuestion(me(req), b)));
}));

const idParam = validate({ params: z.object({ id }) });
async function ownQuestion(req: unknown, qid: string): Promise<Question> {
  const q = await prisma.question.findFirst({ where: { id: qid, teacherId: me(req), archivedAt: null } });
  if (!q) throw new AppError('NOT_FOUND', 404, 'Question not found.');
  return q;
}

bankRouter.patch('/:id', idParam, validate({ body: questionPatchBody }), asyncHandler(async (req, res) => {
  const q = await ownQuestion(req, req.params.id as string);
  const b = req.body as z.infer<typeof questionPatchBody>;
  const data: Prisma.QuestionUpdateInput = {};
  if (b.text !== undefined) data.text = b.text;
  if (b.marks !== undefined) data.marks = b.marks;
  if (b.chapterId !== undefined) {
    await assertChapter(q.courseId, b.chapterId);
    data.chapter = b.chapterId ? { connect: { id: b.chapterId } } : { disconnect: true };
  }
  if (b.type !== undefined || b.options !== undefined || b.correct !== undefined) {
    const type = b.type ?? q.type;
    const options = b.options ? optionList(b.options) : (q.options as Opt[]);
    let idx = b.correct;
    if (!idx) {
      if (b.options) throw new AppError('VALIDATION_ERROR', 400, 'Send the correct options with new options.', { correct: 'Required' });
      idx = (q.correct as string[]).map((c) => options.findIndex((o) => o.id === c));
    }
    const msg = checkQuestionShape({ type, optionCount: options.length, correct: idx });
    if (msg) throw new AppError('VALIDATION_ERROR', 400, msg, { correct: msg });
    data.type = type;
    data.options = options;
    data.correct = correctIds(idx);
  }
  // Exams hold their own copy (snapshot), so this never reaches a published or past exam (EXAM-13).
  res.json(questionView(await prisma.question.update({ where: { id: q.id }, data })));
}));

bankRouter.delete('/:id', idParam, asyncHandler(async (req, res) => {
  const q = await ownQuestion(req, req.params.id as string);
  await prisma.question.update({ where: { id: q.id }, data: { archivedAt: new Date() } });
  res.json({ ok: true });
}));

// ───── CSV import: text,option1..option6,correct(1;3),marks,chapter ─────
const MAX_ROWS = 500;
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });
const importQuery = z.object({ courseId: id, dryRun: z.enum(['true', 'false', '1', '0']).optional() });

export interface ImportRowError { row: number; field: string; message: string }

/** Parses and validates the whole file; nothing is written here. */
export async function parseQuestionCsv(buffer: Buffer, courseId: string): Promise<{ rows: z.infer<typeof questionBody>[]; errors: ImportRowError[] }> {
  let raw: Record<string, string>[];
  try {
    raw = parse(buffer, { bom: true, columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
  } catch {
    throw new AppError('VALIDATION_ERROR', 400, 'The file is not a valid CSV.', { file: 'invalid_csv' });
  }
  if (raw.length === 0) throw new AppError('VALIDATION_ERROR', 400, 'The file has no rows.', { file: 'empty' });
  if (raw.length > MAX_ROWS) throw new AppError('VALIDATION_ERROR', 400, `At most ${MAX_ROWS} rows per file.`, { file: 'too_many_rows' });
  const missing = ['text', 'option1', 'option2', 'correct'].filter((c) => !(c in raw[0]!));
  if (missing.length) throw new AppError('VALIDATION_ERROR', 400, `Missing columns: ${missing.join(', ')}.`, { file: 'missing_columns' });

  const chapters = await prisma.chapter.findMany({ where: { courseId }, select: { id: true, name: true } });
  const byName = new Map(chapters.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const errors: ImportRowError[] = [];
  const rows: z.infer<typeof questionBody>[] = [];
  raw.forEach((r, i) => {
    const row = i + 2; // header is row 1
    const err = (field: string, message: string) => errors.push({ row, field, message });
    const cells = Array.from({ length: OPTION_MAX }, (_, k) => (r[`option${k + 1}`] ?? '').trim());
    const last = cells.reduce((m, t, k) => (t ? k : m), -1);
    const options = cells.slice(0, last + 1);
    if (options.some((o) => !o)) return err('options', 'Options must be filled in order, with no gaps');
    const idx = (r.correct ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((x) => Number(x) - 1);
    if (idx.some((n) => !Number.isInteger(n))) return err('correct', 'Use option numbers such as 1 or 1;3');
    const marks = r.marks ? Number(r.marks) : 1;
    if (!marksSchema.safeParse(marks).success) return err('marks', 'Marks: 0.5 to 100 in steps of 0.5');
    let chapterId: string | null = null;
    if (r.chapter) {
      chapterId = byName.get(r.chapter.trim().toLowerCase()) ?? null;
      if (!chapterId) return err('chapter', `Chapter "${r.chapter}" is not in this course`);
    }
    const type = idx.length > 1 ? 'multiple' : 'single';
    const shape = checkQuestionShape({ type, optionCount: options.length, correct: idx });
    if (shape) return err('correct', shape);
    if (!r.text?.trim()) return err('text', 'Question text is required');
    if (r.text.length > 2000 || options.some((o) => o.length > 500)) return err('text', 'Text is too long');
    rows.push({ courseId, chapterId, type, text: r.text.trim(), options: options.map((text) => ({ text })), correct: idx, marks });
  });
  return { rows, errors };
}

bankRouter.post('/import', (req, res, next) =>
  csvUpload.single('file')(req, res, (e: unknown) => (e ? next(new AppError('VALIDATION_ERROR', 400, 'Upload one CSV file of at most 1 MB.', { file: 'upload' })) : next())),
  validate({ query: importQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof importQuery>;
    const file = (req as unknown as { file?: { buffer: Buffer } }).file;
    if (!file) throw new AppError('VALIDATION_ERROR', 400, 'Attach a CSV file.', { file: 'missing' });
    await assertTeachesCourse(me(req), q.courseId);
    const { rows, errors } = await parseQuestionCsv(file.buffer, q.courseId);
    if (errors.length) {
      return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Nothing was imported. Fix the rows below and upload again.' }, errors });
    }
    if (q.dryRun === 'true' || q.dryRun === '1') return void res.json({ dryRun: true, valid: rows.length });
    await prisma.$transaction(async (tx) => {
      for (const r of rows) await createQuestion(me(req), r, tx);
    }, { timeout: 60_000, maxWait: 10_000 });
    res.status(201).json({ created: rows.length });
  }));
