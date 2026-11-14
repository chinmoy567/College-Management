import { Prisma } from '@prisma/client';
import { type GradeBand, SETTING_DEFAULTS } from '@cms/shared';
import { prisma } from '../../db';
import { overallCoursePercent, percent, rankCompetition } from './logic';

type Db = Prisma.TransactionClient | typeof prisma;

export interface BestRow {
  examId: string;
  studentId: string;
  sectionId: string;
  score: number;
  attemptId: string;
}

/** Each student's best finished attempt per exam (exam: the single attempt; quiz: the best, 05 §7). Reopened attempts have no score and are skipped. */
export async function bestAttempts(examIds: string[], db: Db = prisma): Promise<BestRow[]> {
  if (examIds.length === 0) return [];
  const rows = await db.$queryRaw<{ exam_id: string; student_id: string; section_id: string; score: Prisma.Decimal; id: string }[]>(Prisma.sql`
    SELECT DISTINCT ON (exam_id, student_id) exam_id, student_id, section_id, score, id
    FROM exam_attempts
    WHERE exam_id IN (${Prisma.join(examIds)}) AND status <> 'in_progress' AND score IS NOT NULL
    ORDER BY exam_id, student_id, score DESC, attempt_no ASC`);
  return rows.map((r) => ({ examId: r.exam_id, studentId: r.student_id, sectionId: r.section_id, score: Number(r.score), attemptId: r.id }));
}

export interface ExamStanding {
  rank: number;
  /** Students who took it in the same section. */
  of: number;
  sectionAverage: number;
}

/** Competition ranking inside the attempt's section (never group- or college-wide, EXAM-14). Returns studentId → standing. */
export function standingsFor(rows: BestRow[], totalMarks: number): Map<string, ExamStanding> {
  const out = new Map<string, ExamStanding>();
  const bySection = new Map<string, BestRow[]>();
  for (const r of rows) bySection.set(r.sectionId, [...(bySection.get(r.sectionId) ?? []), r]);
  for (const group of bySection.values()) {
    const ranks = rankCompetition(group.map((r) => ({ key: r.studentId, score: r.score })));
    const avg = Math.round((group.reduce((s, r) => s + percent(r.score, totalMarks), 0) / group.length) * 100) / 100;
    for (const r of group) out.set(r.studentId, { rank: ranks.get(r.studentId)!, of: group.length, sectionAverage: avg });
  }
  return out;
}

export async function gradeScale(db: Db = prisma): Promise<GradeBand[]> {
  const s = await db.setting.findUnique({ where: { key: 'grading_scale' } });
  const v = s?.value as GradeBand[] | undefined;
  return Array.isArray(v) && v.length ? v : [...SETTING_DEFAULTS.grading_scale];
}

export interface CourseStanding {
  studentId: string;
  name: string;
  roll: string | null;
  percent: number | null;
  rank: number | null;
  examsCounted: number;
  missed: number;
}

/**
 * Overall course ranking (05 §7): average % over the offering's Exams whose results are published, a missed exam
 * counts as 0%, quizzes are excluded. Students are the active enrollments; ranked within the offering's section.
 */
export async function courseStandings(offeringId: string, db: Db = prisma): Promise<{ exams: { id: string; title: string; totalMarks: number; passMarks: number }[]; rows: CourseStanding[]; scores: Map<string, Map<string, number>> }> {
  const exams = await db.exam.findMany({
    where: { courseOfferingId: offeringId, kind: 'exam', resultsPublishedAt: { not: null }, revealedAt: { not: null } },
    select: { id: true, title: true, totalMarks: true, passMarks: true },
    orderBy: { startAt: 'asc' },
  });
  const students = await db.enrollment.findMany({
    where: { courseOfferingId: offeringId, status: 'active' },
    select: { studentId: true, student: { select: { name: true, roll: true } } },
  });
  const best = await bestAttempts(exams.map((e) => e.id), db);
  const scores = new Map<string, Map<string, number>>(); // studentId → examId → score
  for (const b of best) scores.set(b.studentId, (scores.get(b.studentId) ?? new Map()).set(b.examId, b.score));
  const exList = exams.map((e) => ({ id: e.id, totalMarks: Number(e.totalMarks), kind: 'exam' as const }));
  const rows: CourseStanding[] = students.map((s) => {
    const mine = scores.get(s.studentId) ?? new Map<string, number>();
    return {
      studentId: s.studentId, name: s.student.name, roll: s.student.roll,
      percent: overallCoursePercent(exList, mine), rank: null, examsCounted: exList.length, missed: exList.filter((e) => !mine.has(e.id)).length,
    };
  });
  const ranked = rankCompetition(rows.filter((r) => r.percent !== null).map((r) => ({ key: r.studentId, score: r.percent! })));
  for (const r of rows) r.rank = ranked.get(r.studentId) ?? null;
  rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name));
  return { exams: exams.map((e) => ({ id: e.id, title: e.title, totalMarks: Number(e.totalMarks), passMarks: Number(e.passMarks) })), rows, scores };
}
