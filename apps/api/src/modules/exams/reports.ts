import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { adminPerformanceQuery, id } from '@cms/shared';
import { prisma } from '../../db';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { requireRole } from '../../middleware/session';
import { examForViewer, offeringForViewer } from './access';
import { gradeFor, percent } from './logic';
import { csvFile, simplePdf } from './pdf';
import { contextOf, offeringContext } from './context';
import { bestAttempts, courseStandings, gradeScale } from './ranks';
import { ensureRevealed, revealDue } from './reveal';

/** Teacher / mentor / Admin views (05 §7): exam report, offering progress, college-wide performance. */
export const reportRouter = Router();
export const adminExamsRouter = Router();
const idParam = validate({ params: z.object({ id }) });

const INTEGRITY_KINDS = ['blur', 'focus', 'fullscreen_exit', 'visibility_hidden'] as const;

export async function examReport(examId: string) {
  await ensureRevealed(examId);
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  const total = Number(exam.totalMarks);
  const [attempts, enrolled, questions, best] = await Promise.all([
    prisma.examAttempt.findMany({ where: { examId }, include: { student: { select: { name: true, roll: true } } }, orderBy: [{ studentId: 'asc' }, { attemptNo: 'asc' }] }),
    prisma.enrollment.findMany({ where: { courseOfferingId: exam.courseOfferingId, status: 'active' }, select: { studentId: true, student: { select: { name: true, roll: true } } } }),
    prisma.examQuestion.findMany({ where: { examId }, orderBy: { order: 'asc' }, select: { id: true, order: true, text: true, marks: true, isCancelled: true } }),
    bestAttempts([examId]),
  ]);
  const scores = best.map((b) => b.score);
  const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9.99, count: 0 }));
  for (const s of scores) buckets[Math.min(9, Math.floor(percent(s, total) / 10))]!.count += 1;
  const perQ = best.length
    ? await prisma.$queryRaw<{ q: string; ok: number; n: number }[]>(Prisma.sql`
        SELECT exam_question_id AS q, (count(*) FILTER (WHERE is_correct))::int AS ok, count(*)::int AS n
        FROM answers WHERE attempt_id IN (${Prisma.join(best.map((b) => b.attemptId))}) GROUP BY exam_question_id`)
    : [];
  const pq = new Map(perQ.map((r) => [r.q, r]));
  const took = new Set(attempts.map((a) => a.studentId));
  return {
    exam: { ...(await offeringContext(exam.courseOfferingId)), id: exam.id, title: exam.title, kind: exam.kind, totalMarks: total, passMarks: Number(exam.passMarks), status: exam.status, startAt: exam.startAt, endAt: exam.endAt, revealedAt: exam.revealedAt, resultsPublishedAt: exam.resultsPublishedAt },
    summary: {
      enrolled: enrolled.length, attended: took.size,
      highest: scores.length ? Math.max(...scores) : null, lowest: scores.length ? Math.min(...scores) : null,
      average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null,
      passed: scores.filter((s) => s >= Number(exam.passMarks)).length,
    },
    distribution: buckets,
    perQuestion: questions.map((q) => {
      const r = pq.get(q.id);
      return { examQuestionId: q.id, order: q.order, text: q.text, marks: Number(q.marks), isCancelled: q.isCancelled, correctPct: r && r.n ? percent(r.ok, r.n) : null, answered: r?.n ?? 0 };
    }),
    didNotAttend: enrolled.filter((e) => !took.has(e.studentId)).map((e) => ({ studentId: e.studentId, name: e.student.name, roll: e.student.roll })),
    attempts: attempts.map((a) => {
      const log = (a.integrityLog as { type: string }[]) ?? [];
      const counts = Object.fromEntries(INTEGRITY_KINDS.map((k) => [k, log.filter((e) => e.type === k).length])) as Record<(typeof INTEGRITY_KINDS)[number], number>;
      return {
        attemptId: a.id, studentId: a.studentId, name: a.student.name, roll: a.student.roll, attemptNo: a.attemptNo, status: a.status,
        score: a.score === null ? null : Number(a.score), submittedAt: a.submittedAt, extraMinutes: a.extraMinutes, integrity: { ...counts, total: log.length },
      };
    }),
  };
}

reportRouter.get('/:id/report', idParam, asyncHandler(async (req, res) => {
  const exam = await examForViewer(req, req.params.id as string);
  if (exam.status === 'draft') throw new AppError('NOT_FOUND', 404, 'Exam not found.');
  res.json(await examReport(exam.id));
}));

const attachment = (res: import('express').Response, type: string, name: string, body: Buffer) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(body);
};

reportRouter.get('/:id/report.csv', idParam, asyncHandler(async (req, res) => {
  const exam = await examForViewer(req, req.params.id as string);
  if (exam.status === 'draft') throw new AppError('NOT_FOUND', 404, 'Exam not found.');
  const r = await examReport(exam.id);
  const rows: (string | number | null)[][] = [['roll', 'name', 'status', 'attempt', 'score', 'total', 'percentage', 'integrity_events']];
  for (const a of r.attempts) rows.push([a.roll, a.name, a.status, a.attemptNo, a.score, r.exam.totalMarks, a.score === null ? null : percent(a.score, r.exam.totalMarks), a.integrity.total]);
  for (const d of r.didNotAttend) rows.push([d.roll, d.name, 'did_not_attend', null, null, r.exam.totalMarks, null, null]);
  attachment(res, 'text/csv; charset=utf-8', 'exam-report.csv', csvFile(rows));
}));

reportRouter.get('/:id/report.pdf', idParam, asyncHandler(async (req, res) => {
  const exam = await examForViewer(req, req.params.id as string);
  if (exam.status === 'draft') throw new AppError('NOT_FOUND', 404, 'Exam not found.');
  const r = await examReport(exam.id);
  const s = r.summary;
  const pdf = await simplePdf(`Report: ${r.exam.title}`, [
    { p: `Total marks ${r.exam.totalMarks} · Pass marks ${r.exam.passMarks} · Attended ${s.attended} of ${s.enrolled}` },
    { p: `Highest ${s.highest ?? '-'} · Average ${s.average ?? '-'} · Lowest ${s.lowest ?? '-'}` },
    { h: 'Score distribution' },
    { table: r.distribution.map((b) => [`${b.from}-${Math.floor(b.to)}%`, String(b.count)]), widths: [120, 60] },
    { h: 'Per question' },
    { table: r.perQuestion.map((q) => [String(q.order), q.text.slice(0, 70), q.correctPct === null ? '-' : `${q.correctPct}%`]), widths: [30, 400, 60] },
    { h: 'Students' },
    { table: [['Roll', 'Name', 'Status', 'Score', 'Integrity'], ...r.attempts.map((a) => [a.roll ?? '', a.name, a.status, String(a.score ?? '-'), String(a.integrity.total)]), ...r.didNotAttend.map((d) => [d.roll ?? '', d.name, 'did not attend', '-', '-'])], widths: [50, 200, 100, 60, 60] },
  ]);
  attachment(res, 'application/pdf', 'exam-report.pdf', pdf);
}));

// ───── offering progress ─────
export const offeringProgressRouter = Router();
/** GET /api/exams/offerings — the offerings the signed-in teacher teaches or mentors (the exam screens' course picker). */
offeringProgressRouter.get('/', requireRole('teacher'), asyncHandler(async (req, res) => {
  const me = (req as unknown as { user: { id: string } }).user.id;
  const rows = await prisma.courseOffering.findMany({
    where: { endedAt: null, OR: [{ teacherId: me }, { section: { mentorTeacherId: me } }] },
    include: { course: { select: { id: true, code: true, name: true } }, section: { select: { name: true, classLevel: true, group: { select: { type: true, session: { select: { name: true } } } } } } },
    orderBy: [{ course: { code: 'asc' } }, { createdAt: 'asc' }],
  });
  res.json({
    items: rows.map((o) => ({
      id: o.id, courseId: o.courseId, ...contextOf(o), teaches: o.teacherId === me,
    })),
  });
}));
offeringProgressRouter.get('/:id/progress', idParam, asyncHandler(async (req, res) => {
  const o = await offeringForViewer(req, req.params.id as string);
  await revealDue(await prisma.exam.findMany({ where: { courseOfferingId: o.id, status: { not: 'draft' } }, select: { id: true, endAt: true, revealedAt: true, status: true } }));
  const [{ exams, rows, scores }, scale] = await Promise.all([courseStandings(o.id), gradeScale()]);
  const belowPass = rows.flatMap((r) => {
    const mine = scores.get(r.studentId) ?? new Map<string, number>();
    const failed = exams.filter((e) => (mine.get(e.id) ?? -1) < e.passMarks).map((e) => ({ examId: e.id, title: e.title, score: mine.get(e.id) ?? null, passMarks: e.passMarks }));
    return failed.length ? [{ studentId: r.studentId, name: r.name, roll: r.roll, exams: failed }] : [];
  });
  res.json({
    ...(await offeringContext(o.id)), offeringId: o.id, courseId: o.courseId, sectionId: o.sectionId, exams,
    students: rows.map((r) => ({ ...r, grade: r.percent === null ? null : gradeFor(r.percent, scale) })),
    belowPass,
  });
}));

// ───── Admin: college-wide performance ─────
adminExamsRouter.get('/performance', requireRole('admin'), validate({ query: adminPerformanceQuery }), asyncHandler(async (req, res) => {
  const { by } = req.query as unknown as z.infer<typeof adminPerformanceQuery>;
  const rows = await prisma.$queryRaw<{ exam_id: string; session_id: string; session_name: string; group_id: string; group_type: string; section_id: string; section_name: string; class_level: number; course_id: string; course_code: string; attended: number; enrolled: number; avg_pct: number | null }[]>(Prisma.sql`
    WITH best AS (
      SELECT DISTINCT ON (exam_id, student_id) exam_id, student_id, score FROM exam_attempts
      WHERE status <> 'in_progress' AND score IS NOT NULL ORDER BY exam_id, student_id, score DESC
    )
    SELECT e.id AS exam_id, s.id AS session_id, s.name AS session_name, g.id AS group_id, g.type::text AS group_type,
      sec.id AS section_id, sec.name AS section_name, sec.class_level::int AS class_level, c.id AS course_id, c.code AS course_code,
      (SELECT count(*) FROM best b WHERE b.exam_id = e.id)::int AS attended,
      (SELECT count(*) FROM enrollments en WHERE en.course_offering_id = o.id AND en.status = 'active')::int AS enrolled,
      (SELECT avg(b.score / NULLIF(e.total_marks, 0) * 100) FROM best b WHERE b.exam_id = e.id)::float8 AS avg_pct
    FROM exams e
    JOIN course_offerings o ON o.id = e.course_offering_id
    JOIN sections sec ON sec.id = o.section_id
    JOIN groups g ON g.id = sec.group_id
    JOIN sessions s ON s.id = g.session_id
    JOIN courses c ON c.id = o.course_id
    WHERE e.results_published_at IS NOT NULL`);
  const keyOf = (r: (typeof rows)[number]) =>
    by === 'session' ? { key: r.session_id, label: r.session_name }
    : by === 'group' ? { key: r.group_id, label: `${r.session_name} · ${r.group_type}` }
    : by === 'section' ? { key: r.section_id, label: `${r.session_name} · ${r.group_type} · ${r.class_level}-${r.section_name}` }
    : { key: r.course_id, label: r.course_code };
  const acc = new Map<string, { key: string; label: string; exams: number; pctSum: number; pctN: number; attended: number; enrolled: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const e = acc.get(k.key) ?? { ...k, exams: 0, pctSum: 0, pctN: 0, attended: 0, enrolled: 0 };
    e.exams += 1;
    if (r.avg_pct !== null) { e.pctSum += r.avg_pct; e.pctN += 1; }
    e.attended += r.attended;
    e.enrolled += r.enrolled;
    acc.set(k.key, e);
  }
  res.json({
    by,
    items: [...acc.values()].map((e) => ({
      key: e.key, label: e.label, exams: e.exams,
      averagePct: e.pctN ? Math.round((e.pctSum / e.pctN) * 100) / 100 : null,
      participationPct: e.enrolled ? Math.round((e.attended / e.enrolled) * 10_000) / 100 : null,
    })).sort((a, b) => a.label.localeCompare(b.label)),
  });
}));
