import { INACTIVE_DAYS } from '@cms/shared';
import { prisma } from '../../db';
import { AppError } from '../../lib/http';
import { now } from '../../lib/clock';
import { signMany } from '../../lib/files';
import { aggregate, describe, getThresholds, sum } from '../attendance/stats';
import { overallCoursePercent } from '../exams/logic';
import { bestAttempts } from '../exams/ranks';

export type Flag = 'low_attendance' | 'below_pass' | 'inactive';

/** The section this teacher mentors; everything below is scoped to it, so no id from the client can reach another section. */
async function mentoredSection(userId: string) {
  const s = await prisma.section.findFirst({
    where: { mentorTeacherId: userId, deletedAt: null },
    select: { id: true, name: true, classLevel: true, group: { select: { type: true, session: { select: { name: true } } } } },
  });
  if (!s) throw new AppError('FORBIDDEN', 403, 'You are not a Section Mentor.');
  return s;
}

/**
 * Same numbers as `courseStandings` (published + revealed exams only, quizzes excluded, a missed exam counts 0%),
 * but for every offering of the section in three queries instead of several per course: the dev database is remote
 * and 15 courses × ~8 round trips took 10+ seconds.
 */
async function sectionStandings(offerings: { id: string; course: { code: string } }[], studentIds: string[]) {
  const ids = offerings.map((o) => o.id);
  const [exams, enrolled] = await Promise.all([
    prisma.exam.findMany({
      where: { courseOfferingId: { in: ids }, kind: 'exam', resultsPublishedAt: { not: null }, revealedAt: { not: null } },
      select: { id: true, courseOfferingId: true, title: true, totalMarks: true, passMarks: true },
      orderBy: { startAt: 'asc' },
    }),
    prisma.enrollment.findMany({ where: { courseOfferingId: { in: ids }, status: 'active', studentId: { in: studentIds } }, select: { courseOfferingId: true, studentId: true } }),
  ]);
  const best = await bestAttempts(exams.map((e) => e.id));
  const scores = new Map<string, Map<string, number>>(); // studentId → examId → score
  for (const b of best) scores.set(b.studentId, (scores.get(b.studentId) ?? new Map()).set(b.examId, b.score));
  return offerings.map((offering) => {
    const list = exams.filter((e) => e.courseOfferingId === offering.id).map((e) => ({ id: e.id, title: e.title, totalMarks: Number(e.totalMarks), passMarks: Number(e.passMarks) }));
    const forPercent = list.map((e) => ({ id: e.id, totalMarks: e.totalMarks, kind: 'exam' as const }));
    const rows = enrolled.filter((e) => e.courseOfferingId === offering.id).map((e) => ({ studentId: e.studentId, percent: overallCoursePercent(forPercent, scores.get(e.studentId) ?? new Map<string, number>()) }));
    return { offering, s: { exams: list, rows, scores } };
  });
}

/** One pass over the section: students, attendance, published exam results and activity. */
async function load(userId: string) {
  const section = await mentoredSection(userId);
  const [th, offerings, profiles] = await Promise.all([
    getThresholds(),
    prisma.courseOffering.findMany({ where: { sectionId: section.id, endedAt: null }, select: { id: true, course: { select: { code: true } } }, orderBy: { course: { code: 'asc' } } }),
    prisma.studentProfile.findMany({
      where: { sectionId: section.id, user: { status: 'active' } },
      select: { userId: true, name: true, roll: true, user: { select: { loginId: true, avatarId: true, lastLoginAt: true } } },
    }),
  ]);
  const studentIds = profiles.map((p) => p.userId);
  const offeringIds = offerings.map((o) => o.id);
  const [att, seen, standings, avatars, conv] = await Promise.all([
    aggregate({ studentIds, offeringIds }),
    prisma.loginSession.groupBy({ by: ['userId'], where: { userId: { in: studentIds } }, _max: { lastSeenAt: true } }),
    sectionStandings(offerings, studentIds),
    signMany(profiles.map((p) => p.user.avatarId).filter((x): x is string => !!x)),
    prisma.conversation.findUnique({ where: { type_refId: { type: 'section', refId: section.id } }, select: { id: true } }),
  ]);
  const seenAt = new Map(seen.map((r) => [r.userId, r._max.lastSeenAt]));
  const cutoff = now().getTime() - INACTIVE_DAYS * 86_400_000;

  const students = profiles
    .map((p) => {
      const a = describe(sum(att.filter((r) => r.studentId === p.userId)), th);
      const percents: number[] = [];
      let belowPass = false;
      for (const { s } of standings) {
        const row = s.rows.find((r) => r.studentId === p.userId);
        if (!row) continue;
        if (row.percent !== null) percents.push(row.percent);
        const sc = s.scores.get(p.userId) ?? new Map<string, number>();
        if (s.exams.some((e) => (sc.get(e.id) ?? -1) < e.passMarks)) belowPass = true;
      }
      const times = [p.user.lastLoginAt, seenAt.get(p.userId)].filter((d): d is Date => !!d);
      const lastActiveAt = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
      const flags: Flag[] = [];
      if (a.pct !== null && a.pct < th.threshold) flags.push('low_attendance');
      if (belowPass) flags.push('below_pass');
      if (!lastActiveAt || lastActiveAt.getTime() < cutoff) flags.push('inactive');
      return {
        id: p.userId, name: p.name, roll: p.roll, loginId: p.user.loginId,
        avatarUrl: p.user.avatarId ? (avatars.get(p.user.avatarId) ?? null) : null,
        attendancePct: a.pct,
        examAvgPct: percents.length ? Math.round((percents.reduce((x, y) => x + y, 0) / percents.length) * 100) / 100 : null,
        lastActiveAt, flags,
      };
    })
    .sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true }));
  return { section, th, offerings, att, standings, students, chatConversationId: conv?.id ?? null };
}

export async function sectionOverview(userId: string) {
  const d = await load(userId);
  const count = (f: Flag) => d.students.filter((s) => s.flags.includes(f)).length;
  return {
    section: { id: d.section.id, name: d.section.name, classLevel: d.section.classLevel, group: d.section.group.type, session: d.section.group.session.name },
    chatConversationId: d.chatConversationId,
    thresholds: { attendance: d.th.threshold, inactiveDays: INACTIVE_DAYS },
    summary: {
      students: d.students.length,
      attendancePct: describe(sum(d.att), d.th).pct,
      lowAttendance: count('low_attendance'),
      belowPass: count('below_pass'),
      inactive: count('inactive'),
    },
  };
}

export async function sectionStudents(userId: string) {
  return { items: (await load(userId)).students };
}

export async function sectionStudent(userId: string, studentId: string) {
  const d = await load(userId);
  const st = d.students.find((s) => s.id === studentId);
  if (!st) throw new AppError('NOT_FOUND', 404, 'Student not found.');
  const attendance = d.offerings.map((o) => {
    const c = describe(sum(d.att.filter((r) => r.studentId === studentId && r.offeringId === o.id)), d.th);
    return { offeringId: o.id, course: o.course.code, pct: c.pct, present: c.present, held: c.held };
  });
  const exams = d.standings.flatMap(({ offering, s }) => {
    if (!s.rows.some((r) => r.studentId === studentId)) return [];
    const sc = s.scores.get(studentId) ?? new Map<string, number>();
    return s.exams.map((e) => {
      const score = sc.get(e.id) ?? null;
      return { offeringId: offering.id, course: offering.course.code, examId: e.id, title: e.title, score, totalMarks: e.totalMarks, passMarks: e.passMarks, passed: score !== null && score >= e.passMarks };
    });
  });
  return { ...st, attendance, exams };
}
