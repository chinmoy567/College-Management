import { Router } from 'express';
import { z } from 'zod';
import { dhakaDate as dateSchema, id, manualMeetingBody, recordPatch, sheetBody } from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { permissionsFor } from '../../lib/permissions';
import { dhakaDate, toUtc } from '../../lib/time';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { meetingView } from '../schedule/calendar';
import { dateOnly, hhmmOf, ymdOf } from '../schedule/generate';
import { sheetView, submitSheet } from './sheet';
import { aggregate, describe, getThresholds, sum } from './stats';

/** /api/attendance (04 §6, §7.1). */
export const attendanceRouter = Router();
const idParam = validate({ params: z.object({ id }) });
const asReq = (req: unknown) => req as AuthedRequest;

const meetingInclude = {
  period: true, room: true,
  teacher: { select: { userId: true, name: true } },
  substituteTeacher: { select: { userId: true, name: true } },
  offerings: { include: { courseOffering: { include: { course: true, section: { include: { group: true } } } } } },
} as const;

// ───── teacher: today / pending ─────
attendanceRouter.get('/today', requireRole('teacher'), asyncHandler(async (req, res) => {
  const me = asReq(req).user.id;
  const rows = await prisma.classMeeting.findMany({
    where: { date: dateOnly(dhakaDate()), status: { in: ['scheduled', 'held'] }, OR: [{ teacherId: me }, { substituteTeacherId: me }] },
    include: meetingInclude,
    orderBy: { startTime: 'asc' },
  });
  res.json({ meetings: rows.map((m) => ({ ...meetingView(m), done: !!m.attendanceTakenAt })) });
}));

attendanceRouter.get('/pending', requireRole('teacher', 'admin'), validate({ query: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }) }), asyncHandler(async (req, res) => {
  const r = asReq(req);
  const q = req.query as { from?: string; to?: string };
  const today = dhakaDate();
  const to = q.to && q.to < today ? q.to : today;
  const scope =
    r.user.role === 'admin'
      ? {}
      : { OR: [{ teacherId: r.user.id }, { substituteTeacherId: r.user.id }, { offerings: { some: { courseOffering: { section: { mentorTeacherId: r.user.id } } } } }] };
  const rows = await prisma.classMeeting.findMany({
    where: { status: 'scheduled', attendanceTakenAt: null, date: { ...(q.from ? { gte: dateOnly(q.from) } : {}), lte: dateOnly(to) }, ...scope },
    include: meetingInclude,
    orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
    take: 300,
  });
  // today's classes that have not started or ended yet are not "Not taken"
  const past = rows.filter((m) => ymdOf(m.date) < today || toUtc(ymdOf(m.date), hhmmOf(m.endTime)) <= new Date());
  res.json({ meetings: past.map(meetingView) });
}));

// ───── sheet ─────
async function assertCanTake(req: unknown, meetingId: string) {
  const r = asReq(req);
  if (!(await permissionsFor(r).canTakeAttendance(r.actor, meetingId))) {
    const exists = await prisma.classMeeting.findUnique({ where: { id: meetingId }, select: { id: true } });
    throw exists ? new AppError('FORBIDDEN', 403, 'Not allowed.') : new AppError('NOT_FOUND', 404, 'Class not found.');
  }
}

attendanceRouter.get('/meetings/:id/sheet', idParam, asyncHandler(async (req, res) => {
  await assertCanTake(req, req.params.id as string);
  res.json(await sheetView(req.params.id as string));
}));

attendanceRouter.post('/meetings/:id/sheet', idParam, validate({ body: sheetBody }), asyncHandler(async (req, res) => {
  await assertCanTake(req, req.params.id as string);
  const r = asReq(req);
  res.json(await submitSheet(req.params.id as string, r.actor, req.body as never, r.ip));
}));

attendanceRouter.post('/manual-meeting', requireRole('teacher'), validate({ body: manualMeetingBody }), asyncHandler(async (req, res) => {
  const b = req.body as { offeringId: string; date: string; periodId: string };
  const r = asReq(req);
  if (b.date > dhakaDate()) throw new AppError('VALIDATION_ERROR', 400, 'Choose today or an earlier date.', { date: 'In the future' });
  const offering = await prisma.courseOffering.findUnique({ where: { id: b.offeringId } });
  if (!offering || offering.endedAt || offering.teacherId !== r.user.id) throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  const period = await prisma.period.findFirst({ where: { id: b.periodId, deletedAt: null } });
  if (!period) throw new AppError('VALIDATION_ERROR', 400, 'Period not found.', { periodId: 'Not found' });
  const existing = await prisma.classMeeting.findFirst({
    where: { date: dateOnly(b.date), periodId: b.periodId, status: { in: ['scheduled', 'held'] }, offerings: { some: { courseOfferingId: b.offeringId } } },
    include: meetingInclude,
  });
  if (existing) return void res.json(meetingView(existing));
  const m = await prisma.classMeeting.create({
    data: {
      date: dateOnly(b.date), periodId: period.id, startTime: period.startTime, endTime: period.endTime, teacherId: r.user.id,
      offerings: { create: [{ courseOfferingId: b.offeringId }] },
    },
    include: meetingInclude,
  });
  res.status(201).json(meetingView(m));
}));

attendanceRouter.patch('/records/:id', idParam, validate({ body: recordPatch }), asyncHandler(async (req, res) => {
  const r = asReq(req);
  const rec = await prisma.attendanceRecord.findUnique({ where: { id: req.params.id as string }, include: { courseOffering: { select: { sectionId: true } } } });
  if (!rec) throw new AppError('NOT_FOUND', 404, 'Record not found.');
  const perms = permissionsFor(req);
  const allowed =
    r.actor.role === 'admin' ||
    (r.actor.role === 'teacher' && ((await perms.canTakeAttendance(r.actor, rec.classMeetingId)) || (await perms.mentorsSection(r.actor, rec.sectionId))));
  if (!allowed) throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  const { status } = req.body as { status: typeof rec.status };
  if (status !== rec.status) {
    await prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.update({ where: { id: rec.id }, data: { status, markedBy: r.user.id, markedAt: new Date() } });
      await tx.attendanceEdit.create({ data: { attendanceRecordId: rec.id, oldStatus: rec.status, newStatus: status, editedBy: r.user.id } });
      if (r.actor.role === 'admin') await audit(r.user.id, 'attendance.record_edit', 'attendance_record', rec.id, { from: rec.status, to: status }, r.ip, tx);
    });
  }
  res.json({ ok: true });
}));

// ───── student views ─────
const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), courseId: id.optional() });

attendanceRouter.get('/me', requireRole('student'), asyncHandler(async (req, res) => {
  const me = asReq(req).user.id;
  const [rows, th, offerings] = await Promise.all([
    aggregate({ studentIds: [me] }),
    getThresholds(),
    prisma.courseOffering.findMany({ where: { enrollments: { some: { studentId: me } } }, include: { course: true } }),
  ]);
  const byOffering = new Map(rows.map((r) => [r.offeringId, r]));
  res.json({
    threshold: th.threshold,
    overall: describe(sum(rows), th),
    courses: offerings.map((o) => ({ offeringId: o.id, courseId: o.courseId, code: o.course.code, name: o.course.name, ...describe(byOffering.get(o.id) ?? { present: 0, excused: 0, held: 0 }, th) })),
  });
}));

attendanceRouter.get('/me/calendar', requireRole('student'), validate({ query: monthQuery }), asyncHandler(async (req, res) => {
  const me = asReq(req).user.id;
  const month = (req.query as { month?: string }).month ?? dhakaDate().slice(0, 7);
  const { from, to } = monthRange(month);
  const recs = await prisma.attendanceRecord.findMany({
    where: { studentId: me, classMeeting: { date: { gte: dateOnly(from), lte: dateOnly(to) }, status: 'held' } },
    include: { classMeeting: { include: { period: true } }, courseOffering: { include: { course: true } } },
    orderBy: { classMeeting: { startTime: 'asc' } },
  });
  const days = new Map<string, { date: string; colour: string; periods: { period: string | null; course: string; status: string }[] }>();
  for (const r of recs) {
    const d = ymdOf(r.classMeeting.date);
    const e = days.get(d) ?? { date: d, colour: 'present', periods: [] };
    e.periods.push({ period: r.classMeeting.period?.name ?? null, course: r.courseOffering.course.code, status: r.status });
    days.set(d, e);
  }
  for (const e of days.values()) {
    const bad = e.periods.filter((p) => p.status === 'absent').length;
    e.colour = bad === 0 ? 'present' : bad === e.periods.length ? 'absent' : 'partial';
  }
  res.json({ month, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) });
}));

attendanceRouter.get('/me/records', requireRole('student'), validate({ query: monthQuery }), asyncHandler(async (req, res) => {
  const me = asReq(req).user.id;
  const q = req.query as { month?: string; courseId?: string };
  const range = q.month ? monthRange(q.month) : null;
  const recs = await prisma.attendanceRecord.findMany({
    where: {
      studentId: me,
      ...(q.courseId ? { courseOffering: { courseId: q.courseId } } : {}),
      classMeeting: { status: 'held', ...(range ? { date: { gte: dateOnly(range.from), lte: dateOnly(range.to) } } : {}) },
    },
    include: { classMeeting: { include: { period: true } }, courseOffering: { include: { course: true } } },
    orderBy: { classMeeting: { date: 'desc' } },
    take: 400,
  });
  res.json({ records: recs.map((r) => ({ id: r.id, date: ymdOf(r.classMeeting.date), period: r.classMeeting.period?.name ?? null, course: r.courseOffering.course.code, status: r.status })) });
}));

// ───── teacher / mentor / admin views ─────
async function assertOfferingView(req: unknown, offeringId: string) {
  const r = asReq(req);
  if (!(await permissionsFor(r).canManageOffering(r.actor, offeringId, { mentorAllowed: true }))) {
    const exists = await prisma.courseOffering.findUnique({ where: { id: offeringId }, select: { id: true } });
    throw exists ? new AppError('FORBIDDEN', 403, 'Not allowed.') : new AppError('NOT_FOUND', 404, 'Course not found.');
  }
}
async function assertSectionView(req: unknown, sectionId: string) {
  const r = asReq(req);
  if (r.actor.role !== 'admin' && !(await permissionsFor(r).mentorsSection(r.actor, sectionId))) throw new AppError('FORBIDDEN', 403, 'Not allowed.');
}

async function studentSummary(studentIds: string[], offeringIds: string[], th: Awaited<ReturnType<typeof getThresholds>>) {
  const [rows, students] = await Promise.all([
    aggregate({ studentIds, offeringIds }),
    prisma.studentProfile.findMany({ where: { userId: { in: studentIds } }, select: { userId: true, name: true, roll: true } }),
  ]);
  return students
    .map((s) => ({ studentId: s.userId, name: s.name, roll: s.roll, ...describe(sum(rows.filter((r) => r.studentId === s.userId)), th) }))
    .sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true }));
}
const activeStudents = async (offeringIds: string[]) =>
  [...new Set((await prisma.enrollment.findMany({ where: { courseOfferingId: { in: offeringIds }, status: 'active' }, select: { studentId: true } })).map((e) => e.studentId))];

attendanceRouter.get('/offerings/:id/register', idParam, validate({ query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }) }), asyncHandler(async (req, res) => {
  const offeringId = req.params.id as string;
  await assertOfferingView(req, offeringId);
  const month = (req.query as { month?: string }).month ?? dhakaDate().slice(0, 7);
  const { from, to } = monthRange(month);
  const meetings = await prisma.classMeeting.findMany({
    where: { status: 'held', date: { gte: dateOnly(from), lte: dateOnly(to) }, offerings: { some: { courseOfferingId: offeringId } } },
    include: { attendance: { where: { courseOfferingId: offeringId } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
  const students = await prisma.studentProfile.findMany({
    where: { userId: { in: [...new Set([...(await activeStudents([offeringId])), ...meetings.flatMap((m) => m.attendance.map((a) => a.studentId))])] } },
    select: { userId: true, name: true, roll: true },
  });
  res.json({
    month,
    columns: meetings.map((m) => ({ meetingId: m.id, date: ymdOf(m.date), startTime: hhmmOf(m.startTime) })),
    rows: students.sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true })).map((s) => ({
      studentId: s.userId, name: s.name, roll: s.roll,
      cells: meetings.map((m) => m.attendance.find((a) => a.studentId === s.userId)?.status ?? null),
    })),
  });
}));

attendanceRouter.get('/offerings/:id/summary', idParam, asyncHandler(async (req, res) => {
  const offeringId = req.params.id as string;
  await assertOfferingView(req, offeringId);
  const th = await getThresholds();
  res.json({ threshold: th.threshold, students: await studentSummary(await activeStudents([offeringId]), [offeringId], th) });
}));

attendanceRouter.get('/offerings/:id/low', idParam, validate({ query: z.object({ threshold: z.coerce.number().min(0).max(100).optional() }) }), asyncHandler(async (req, res) => {
  const offeringId = req.params.id as string;
  await assertOfferingView(req, offeringId);
  const th = await getThresholds();
  const limit = (req.query as { threshold?: number }).threshold ?? th.threshold;
  const all = await studentSummary(await activeStudents([offeringId]), [offeringId], th);
  res.json({ threshold: limit, students: all.filter((s) => s.pct !== null && s.pct < limit) });
}));

const sectionOfferingIds = async (sectionId: string) =>
  (await prisma.courseOffering.findMany({ where: { sectionId, endedAt: null }, select: { id: true } })).map((o) => o.id);

attendanceRouter.get('/sections/:id/summary', idParam, asyncHandler(async (req, res) => {
  const sectionId = req.params.id as string;
  await assertSectionView(req, sectionId);
  const th = await getThresholds();
  const offeringIds = await sectionOfferingIds(sectionId);
  res.json({ threshold: th.threshold, students: await studentSummary(await activeStudents(offeringIds), offeringIds, th) });
}));

attendanceRouter.get('/sections/:id/low', idParam, asyncHandler(async (req, res) => {
  const sectionId = req.params.id as string;
  await assertSectionView(req, sectionId);
  const th = await getThresholds();
  const offeringIds = await sectionOfferingIds(sectionId);
  const all = await studentSummary(await activeStudents(offeringIds), offeringIds, th);
  res.json({ threshold: th.threshold, students: all.filter((s) => s.pct !== null && s.pct < th.threshold) });
}));

attendanceRouter.get('/sections/:id/not-taken', idParam, validate({ query: z.object({ date: dateSchema.optional() }) }), asyncHandler(async (req, res) => {
  const sectionId = req.params.id as string;
  await assertSectionView(req, sectionId);
  const date = (req.query as { date?: string }).date ?? dhakaDate();
  const rows = await prisma.classMeeting.findMany({
    where: { date: dateOnly(date), status: 'scheduled', attendanceTakenAt: null, offerings: { some: { courseOffering: { sectionId } } } },
    include: meetingInclude,
    orderBy: { startTime: 'asc' },
  });
  res.json({ date, meetings: rows.map(meetingView) });
}));

// ───── admin ─────
export const adminAttendanceRouter = Router();
adminAttendanceRouter.use(requireRole('admin'));

adminAttendanceRouter.get('/attendance/summary', validate({ query: z.object({ by: z.enum(['session', 'group', 'section', 'course', 'teacher']).default('section') }) }), asyncHandler(async (req, res) => {
  const by = (req.query as { by: string }).by;
  const th = await getThresholds();
  const [rows, offerings] = await Promise.all([
    aggregate({}),
    prisma.courseOffering.findMany({ include: { course: true, teacher: true, section: { include: { group: { include: { session: true } } } } } }),
  ]);
  const meta = new Map(offerings.map((o) => {
    const key = { session: o.section.group.sessionId, group: o.section.groupId, section: o.sectionId, course: o.courseId, teacher: o.teacherId }[by]!;
    const label = { session: o.section.group.session.name, group: `${o.section.group.session.name} ${o.section.group.type}`, section: `${o.section.group.session.name} ${o.section.group.type} · Class ${o.section.classLevel} ${o.section.name}`, course: o.course.code, teacher: o.teacher.name }[by]!;
    return [o.id, { key, label }];
  }));
  const groups = new Map<string, { label: string; rows: typeof rows }>();
  for (const r of rows) {
    const m = meta.get(r.offeringId);
    if (!m) continue;
    const g = groups.get(m.key) ?? { label: m.label, rows: [] };
    g.rows.push(r);
    groups.set(m.key, g);
  }
  res.json({ by, threshold: th.threshold, items: [...groups].map(([key, g]) => ({ key, label: g.label, ...describe(sum(g.rows), th) })).sort((a, b) => a.label.localeCompare(b.label)) });
}));

adminAttendanceRouter.get('/attendance/teachers-not-taken', validate({ query: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query as { from?: string; to?: string };
  const today = dhakaDate();
  const rows = await prisma.classMeeting.findMany({
    where: { status: 'scheduled', attendanceTakenAt: null, date: { ...(q.from ? { gte: dateOnly(q.from) } : {}), lte: dateOnly(q.to && q.to < today ? q.to : today) } },
    select: { teacherId: true, date: true, endTime: true, teacher: { select: { name: true } } },
  });
  const past = rows.filter((m) => ymdOf(m.date) < today || toUtc(ymdOf(m.date), hhmmOf(m.endTime)) <= new Date());
  const by = new Map<string, { teacherId: string; name: string; count: number }>();
  for (const m of past) {
    const e = by.get(m.teacherId) ?? { teacherId: m.teacherId, name: m.teacher.name, count: 0 };
    e.count++;
    by.set(m.teacherId, e);
  }
  res.json({ teachers: [...by.values()].sort((a, b) => b.count - a.count) });
}));

// ───── CSV register export (teacher of offering, mentor, Admin) ─────
const csvCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""');
attendanceRouter.get('/offerings/:id/register.csv', idParam, validate({ query: z.object({ from: dateSchema, to: dateSchema }) }), asyncHandler(async (req, res) => {
  const offeringId = req.params.id as string;
  await assertOfferingView(req, offeringId);
  const q = req.query as unknown as { from: string; to: string };
  const meetings = await prisma.classMeeting.findMany({
    where: { status: 'held', date: { gte: dateOnly(q.from), lte: dateOnly(q.to) }, offerings: { some: { courseOfferingId: offeringId } } },
    include: { attendance: { where: { courseOfferingId: offeringId }, include: { student: { select: { name: true, roll: true } } } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
  const students = new Map<string, { name: string; roll: string }>();
  for (const m of meetings) for (const a of m.attendance) students.set(a.studentId, a.student);
  const header = ['Roll', 'Name', ...meetings.map((m) => `${ymdOf(m.date)} ${hhmmOf(m.startTime)}`)];
  const lines = [header, ...[...students].map(([sid, s]) => [s.roll, s.name, ...meetings.map((m) => m.attendance.find((a) => a.studentId === sid)?.status ?? '')])];
  res.type('text/csv').send('﻿' + lines.map((l) => l.map((c) => `"${csvCell(String(c))}"`).join(',')).join('\r\n'));
}));

