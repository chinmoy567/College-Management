import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { myExamsQuery, myProgressQuery } from '@cms/shared';
import { prisma } from '../../db';
import { asyncHandler, validate } from '../../lib/http';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { chapterStrength, gradeFor, percent } from './logic';
import { simplePdf } from './pdf';
import { bestAttempts, courseStandings, gradeScale, standingsFor } from './ranks';
import { revealDue } from './reveal';
import { myExams } from './views';

/** Student views (05 §7): exam list and progress. Everything is limited to the signed-in student. */
export const meRouter = Router();
meRouter.use(requireRole('student'));
const me = (req: unknown) => (req as AuthedRequest).user.id;

meRouter.get('/', validate({ query: myExamsQuery }), asyncHandler(async (req, res) => {
  res.json(await myExams(me(req), req.query as unknown as z.infer<typeof myExamsQuery>));
}));

/** Results the student may see: window over, no attempt running, results published (rank and per-question data are then allowed). */
export async function studentProgress(studentId: string, courseId?: string) {
  const exams = await prisma.exam.findMany({
    where: {
      status: { in: ['published', 'closed'] },
      courseOffering: { enrollments: { some: { studentId, status: 'active' } }, ...(courseId ? { courseId } : {}) },
    },
    include: { courseOffering: { select: { id: true, courseId: true, course: { select: { code: true, name: true } } } } },
    orderBy: { startAt: 'asc' },
  });
  await revealDue(exams);
  const visible = (await prisma.exam.findMany({ where: { id: { in: exams.map((e) => e.id) }, revealedAt: { not: null }, resultsPublishedAt: { not: null } }, select: { id: true } })).map((e) => e.id);
  const shown = exams.filter((e) => visible.includes(e.id));
  const [best, scale] = await Promise.all([bestAttempts(shown.map((e) => e.id)), gradeScale()]);
  const byExam = new Map<string, typeof best>();
  for (const b of best) byExam.set(b.examId, [...(byExam.get(b.examId) ?? []), b]);

  const results = shown.map((e) => {
    const total = Number(e.totalMarks);
    const mine = (byExam.get(e.id) ?? []).find((b) => b.studentId === studentId);
    const standing = mine ? standingsFor(byExam.get(e.id) ?? [], total).get(studentId) : undefined;
    const pct = mine ? percent(mine.score, total) : null;
    return {
      examId: e.id, title: e.title, kind: e.kind, startAt: e.startAt, courseId: e.courseOffering.courseId, courseCode: e.courseOffering.course.code,
      courseName: e.courseOffering.course.name, score: mine?.score ?? null, totalMarks: total, percentage: pct,
      grade: pct === null ? null : gradeFor(pct, scale), rank: standing?.rank ?? null, of: standing?.of ?? null, sectionAverage: standing?.sectionAverage ?? null,
      missed: !mine,
    };
  });

  // strong / weak chapters from the student's best attempts, over results they may see (cancelled questions do not count)
  const mineIds = best.filter((b) => b.studentId === studentId).map((b) => b.attemptId);
  const chapterRows = mineIds.length
    ? await prisma.$queryRaw<{ chapter_id: string | null; correct: boolean }[]>(Prisma.sql`
        SELECT q.chapter_id, COALESCE(a.is_correct, false) AS correct
        FROM answers a JOIN exam_questions q ON q.id = a.exam_question_id
        WHERE a.attempt_id IN (${Prisma.join(mineIds)}) AND q.is_cancelled = false AND q.chapter_id IS NOT NULL`)
    : [];
  const strength = chapterStrength(chapterRows.map((r) => ({ chapterId: r.chapter_id, correct: r.correct })));
  const names = new Map((await prisma.chapter.findMany({ where: { id: { in: [...strength.strong, ...strength.weak].map((c) => c.chapterId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const label = (c: { chapterId: string; pct: number; total: number }) => ({ ...c, name: names.get(c.chapterId) ?? '' });

  // overall rank per course (Exams only, a missed exam is 0%)
  const offerings = [...new Map(exams.map((e) => [e.courseOffering.id, e.courseOffering])).values()];
  const courses = await Promise.all(offerings.map(async (o) => {
    const { rows } = await courseStandings(o.id);
    const row = rows.find((r) => r.studentId === studentId);
    return {
      offeringId: o.id, courseId: o.courseId, courseCode: o.course.code, courseName: o.course.name,
      percent: row?.percent ?? null, grade: row?.percent == null ? null : gradeFor(row.percent, scale), rank: row?.rank ?? null, of: rows.filter((r) => r.rank !== null).length,
    };
  }));
  const attempted = results.filter((r) => !r.missed);
  return {
    results,
    courses,
    trend: attempted.map((r) => ({ examId: r.examId, at: r.startAt, percentage: r.percentage })),
    sectionAverageSeries: attempted.map((r) => ({ examId: r.examId, at: r.startAt, percentage: r.sectionAverage })),
    chapters: { strong: strength.strong.map(label), weak: strength.weak.map(label) },
  };
}

meRouter.get('/progress', validate({ query: myProgressQuery }), asyncHandler(async (req, res) => {
  res.json(await studentProgress(me(req), (req.query as { courseId?: string }).courseId));
}));

meRouter.get('/progress.pdf', asyncHandler(async (req, res) => {
  const p = await studentProgress(me(req));
  const profile = await prisma.studentProfile.findUnique({ where: { userId: me(req) }, select: { name: true, roll: true } });
  const pdf = await simplePdf(`Result summary${profile ? ` - ${profile.name}` : ''}`, [
    { h: 'Courses' },
    { table: [['Course', 'Overall %', 'Grade', 'Rank'], ...p.courses.map((c) => [c.courseCode, String(c.percent ?? '-'), c.grade ?? '-', c.rank ? `${c.rank} of ${c.of}` : '-'])], widths: [200, 80, 60, 100] },
    { h: 'Results' },
    { table: [['Exam', 'Course', 'Marks', '%', 'Grade', 'Rank'], ...p.results.map((r) => [r.title.slice(0, 40), r.courseCode, r.missed ? 'missed' : `${r.score}/${r.totalMarks}`, String(r.percentage ?? 0), r.grade ?? '-', r.rank ? `${r.rank} of ${r.of}` : '-'])], widths: [170, 70, 70, 50, 50, 80] },
  ]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="result-summary.pdf"');
  res.send(pdf);
}));
