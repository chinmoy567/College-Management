import { Router } from 'express';
import { z } from 'zod';
import {
  calendarQuery, extraMeetingBody, holidayBody, holidayPatch, meetingPatch, specialDayBody, specialDayPatch, id,
} from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { dhakaDate as todayDhaka } from '../../lib/time';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { dateOnly, generateMeetings, hhmmOf, timeDate, ymdOf } from './generate';
import { notifyRoutineChange } from './routine';

/** Holidays, special days, extra classes and single-meeting changes (04 §3). Admin only; reads via /calendar. */
export const calendarRouter = Router();
const adminOnly = requireRole('admin');
const idParam = validate({ params: z.object({ id }) });
const actorId = (req: unknown) => (req as AuthedRequest).user.id;

export const meetingInclude = {
  period: true,
  room: true,
  teacher: { select: { userId: true, name: true } },
  substituteTeacher: { select: { userId: true, name: true } },
  offerings: { include: { courseOffering: { include: { course: true, section: { include: { group: true } } } } } },
} as const;
type MeetingRow = Awaited<ReturnType<typeof prisma.classMeeting.findFirstOrThrow<{ include: typeof meetingInclude }>>>;

export const meetingView = (m: MeetingRow) => ({
  id: m.id,
  date: ymdOf(m.date),
  startTime: hhmmOf(m.startTime),
  endTime: hhmmOf(m.endTime),
  status: m.status,
  extra: m.routineSlotId === null,
  routineSlotId: m.routineSlotId,
  originalDate: m.originalDate ? ymdOf(m.originalDate) : null,
  attendanceTaken: !!m.attendanceTakenAt,
  period: m.period ? { id: m.period.id, name: m.period.name } : null,
  room: m.room ? { id: m.room.id, name: m.room.name } : null,
  teacher: { id: m.teacher.userId, name: m.teacher.name },
  substitute: m.substituteTeacher ? { id: m.substituteTeacher.userId, name: m.substituteTeacher.name } : null,
  onlineClassId: m.onlineClassId,
  offerings: m.offerings.map((o) => ({
    id: o.courseOfferingId,
    sectionId: o.courseOffering.sectionId,
    section: `Class ${o.courseOffering.section.classLevel} · ${o.courseOffering.section.name}`,
    course: { code: o.courseOffering.course.code, name: o.courseOffering.course.name },
  })),
});

const offeringIdsOf = async (meetingId: string) =>
  (await prisma.classMeetingOffering.findMany({ where: { classMeetingId: meetingId }, select: { courseOfferingId: true } })).map((o) => o.courseOfferingId);

// ───── holidays ─────
const holidayView = (h: { id: string; title: string; startDate: Date; endDate: Date }) => ({
  id: h.id, title: h.title, startDate: ymdOf(h.startDate), endDate: ymdOf(h.endDate),
});

async function allActiveOfferingIds(): Promise<string[]> {
  return (await prisma.courseOffering.findMany({ where: { endedAt: null }, select: { id: true } })).map((o) => o.id);
}

calendarRouter.post('/holidays', adminOnly, validate({ body: holidayBody }), asyncHandler(async (req, res) => {
  const b = req.body as { title: string; startDate: string; endDate: string };
  const h = await prisma.holiday.create({ data: { title: b.title, startDate: dateOnly(b.startDate), endDate: dateOnly(b.endDate), createdBy: actorId(req) } });
  await audit(actorId(req), 'holiday.create', 'holiday', h.id, { startDate: b.startDate, endDate: b.endDate });
  await generateMeetings();
  await notifyRoutineChange(await allActiveOfferingIds(), `Holiday: ${b.title}.`);
  res.status(201).json(holidayView(h));
}));

calendarRouter.patch('/holidays/:id', adminOnly, idParam, validate({ body: holidayPatch }), asyncHandler(async (req, res) => {
  const cur = await prisma.holiday.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Holiday not found.');
  const b = req.body as { title?: string; startDate?: string; endDate?: string };
  const start = b.startDate ?? ymdOf(cur.startDate);
  const end = b.endDate ?? ymdOf(cur.endDate);
  if (end < start) throw new AppError('VALIDATION_ERROR', 400, 'End date must not be before start date.', { endDate: 'Before start date' });
  const h = await prisma.holiday.update({ where: { id: cur.id }, data: { title: b.title, startDate: dateOnly(start), endDate: dateOnly(end) } });
  await audit(actorId(req), 'holiday.update', 'holiday', h.id, { startDate: start, endDate: end });
  await generateMeetings();
  res.json(holidayView(h));
}));

calendarRouter.delete('/holidays/:id', adminOnly, idParam, asyncHandler(async (req, res) => {
  const cur = await prisma.holiday.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Holiday not found.');
  await prisma.holiday.delete({ where: { id: cur.id } });
  await audit(actorId(req), 'holiday.delete', 'holiday', cur.id);
  await generateMeetings(); // dates freed by the holiday get their meetings back
  res.json({ ok: true });
}));

// ───── special days ─────
const specialView = (d: { id: string; date: Date; title: string; sessionId: string | null; periodIds: string[] }) => ({
  id: d.id, date: ymdOf(d.date), title: d.title, sessionId: d.sessionId, periodIds: d.periodIds,
});

async function checkSpecialRefs(sessionId: string | null | undefined, periodIds: string[] | undefined) {
  if (sessionId && !(await prisma.session.findUnique({ where: { id: sessionId } })))
    throw new AppError('VALIDATION_ERROR', 400, 'Session not found.', { sessionId: 'Not found' });
  if (periodIds?.length) {
    const n = await prisma.period.count({ where: { id: { in: periodIds }, deletedAt: null } });
    if (n !== new Set(periodIds).size) throw new AppError('VALIDATION_ERROR', 400, 'A period was not found.', { periodIds: 'Not found' });
  }
}

calendarRouter.post('/special-days', adminOnly, validate({ body: specialDayBody }), asyncHandler(async (req, res) => {
  const b = req.body as { date: string; title: string; sessionId?: string | null; periodIds: string[] };
  await checkSpecialRefs(b.sessionId, b.periodIds);
  const dup = await prisma.specialDay.findFirst({ where: { date: dateOnly(b.date), sessionId: b.sessionId ?? null } });
  if (dup) throw new AppError('CONFLICT', 409, 'There is already a special day for that date.');
  const d = await prisma.specialDay.create({
    data: { date: dateOnly(b.date), title: b.title, sessionId: b.sessionId ?? null, periodIds: [...new Set(b.periodIds)], createdBy: actorId(req) },
  });
  await audit(actorId(req), 'special_day.create', 'special_day', d.id, { date: b.date });
  await generateMeetings();
  await notifyRoutineChange(await allActiveOfferingIds(), `Special day: ${b.title}.`);
  res.status(201).json(specialView(d));
}));

calendarRouter.patch('/special-days/:id', adminOnly, idParam, validate({ body: specialDayPatch }), asyncHandler(async (req, res) => {
  const cur = await prisma.specialDay.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Special day not found.');
  const b = req.body as { date?: string; title?: string; sessionId?: string | null; periodIds?: string[] };
  await checkSpecialRefs(b.sessionId, b.periodIds);
  const d = await prisma.specialDay.update({
    where: { id: cur.id },
    data: {
      title: b.title,
      ...(b.date ? { date: dateOnly(b.date) } : {}),
      ...(b.sessionId !== undefined ? { sessionId: b.sessionId } : {}),
      ...(b.periodIds ? { periodIds: [...new Set(b.periodIds)] } : {}),
    },
  });
  await audit(actorId(req), 'special_day.update', 'special_day', d.id, { date: ymdOf(d.date) });
  await generateMeetings();
  res.json(specialView(d));
}));

calendarRouter.delete('/special-days/:id', adminOnly, idParam, asyncHandler(async (req, res) => {
  const cur = await prisma.specialDay.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Special day not found.');
  await prisma.specialDay.delete({ where: { id: cur.id } });
  await audit(actorId(req), 'special_day.delete', 'special_day', cur.id);
  await generateMeetings();
  res.json({ ok: true });
}));

// ───── extra class ─────
calendarRouter.post('/meetings/extra', adminOnly, validate({ body: extraMeetingBody }), asyncHandler(async (req, res) => {
  const b = req.body as { offeringIds: string[]; date: string; periodId?: string; startTime?: string; endTime?: string; roomId?: string | null };
  if (b.date < todayDhaka()) throw new AppError('VALIDATION_ERROR', 400, 'An extra class cannot be in the past.', { date: 'In the past' });
  const offerings = await prisma.courseOffering.findMany({ where: { id: { in: [...new Set(b.offeringIds)] } } });
  if (offerings.length !== new Set(b.offeringIds).size) throw new AppError('NOT_FOUND', 404, 'Course offering not found.');
  if (offerings.some((o) => o.endedAt)) throw new AppError('VALIDATION_ERROR', 400, 'An offering is no longer active.', { offeringIds: 'inactive' });
  if (new Set(offerings.map((o) => o.teacherId)).size > 1)
    throw new AppError('COMBINED_TEACHER_MISMATCH', 400, 'A combined class must have one teacher for all its courses.');
  let start = b.startTime;
  let end = b.endTime;
  if (b.periodId) {
    const p = await prisma.period.findFirst({ where: { id: b.periodId, deletedAt: null } });
    if (!p) throw new AppError('VALIDATION_ERROR', 400, 'Period not found.', { periodId: 'Not found' });
    start = hhmmOf(p.startTime);
    end = hhmmOf(p.endTime);
  }
  if (!start || !end || end <= start) throw new AppError('VALIDATION_ERROR', 400, 'Give a period or a valid start and end time.', { startTime: 'Required' });
  if (b.roomId && !(await prisma.room.findFirst({ where: { id: b.roomId, deletedAt: null } })))
    throw new AppError('VALIDATION_ERROR', 400, 'Room not found.', { roomId: 'Not found' });
  const m = await prisma.classMeeting.create({
    data: {
      date: dateOnly(b.date), periodId: b.periodId ?? null, roomId: b.roomId ?? null,
      startTime: timeDate(start), endTime: timeDate(end), teacherId: offerings[0]!.teacherId,
      offerings: { create: offerings.map((o) => ({ courseOfferingId: o.id })) },
    },
    include: meetingInclude,
  });
  await audit(actorId(req), 'meeting.extra_create', 'class_meeting', m.id, { date: b.date });
  await notifyRoutineChange(offerings.map((o) => o.id), `An extra class was added on ${b.date}.`);
  res.status(201).json(meetingView(m));
}));

// ───── single meeting ─────
async function futureMeeting(meetingId: string) {
  const m = await prisma.classMeeting.findUnique({ where: { id: meetingId } });
  if (!m) throw new AppError('NOT_FOUND', 404, 'Class not found.');
  return m;
}

calendarRouter.patch('/meetings/:id', adminOnly, idParam, validate({ body: meetingPatch }), asyncHandler(async (req, res) => {
  const b = req.body as { periodId?: string; roomId?: string | null; date?: string; substituteTeacherId?: string | null };
  const m = await futureMeeting(req.params.id as string);
  const today = todayDhaka();
  if (ymdOf(m.date) < today) throw new AppError('CONFLICT', 409, 'A past class cannot be changed.');
  if (m.status === 'cancelled' || m.status === 'removed') throw new AppError('CONFLICT', 409, 'This class is cancelled or removed.');
  if (b.date && b.date < today) throw new AppError('VALIDATION_ERROR', 400, 'Choose a date that is not in the past.', { date: 'In the past' });
  const data: Record<string, unknown> = { manuallyEdited: true };
  if (b.periodId) {
    const p = await prisma.period.findFirst({ where: { id: b.periodId, deletedAt: null } });
    if (!p) throw new AppError('VALIDATION_ERROR', 400, 'Period not found.', { periodId: 'Not found' });
    Object.assign(data, { periodId: p.id, startTime: p.startTime, endTime: p.endTime });
  }
  if (b.roomId !== undefined) {
    if (b.roomId && !(await prisma.room.findFirst({ where: { id: b.roomId, deletedAt: null } })))
      throw new AppError('VALIDATION_ERROR', 400, 'Room not found.', { roomId: 'Not found' });
    data.roomId = b.roomId;
  }
  if (b.substituteTeacherId !== undefined) {
    if (b.substituteTeacherId && !(await prisma.teacherProfile.findUnique({ where: { userId: b.substituteTeacherId } })))
      throw new AppError('VALIDATION_ERROR', 400, 'Teacher not found.', { substituteTeacherId: 'Not found' });
    data.substituteTeacherId = b.substituteTeacherId;
  }
  if (b.date && b.date !== ymdOf(m.date)) {
    data.date = dateOnly(b.date);
    if (m.routineSlotId && !m.originalDate) data.originalDate = m.date; // keeps blocking regeneration on the original date
  }
  await prisma.classMeeting.update({ where: { id: m.id }, data });
  await audit(actorId(req), 'meeting.update', 'class_meeting', m.id, { fields: Object.keys(data).filter((k) => k !== 'manuallyEdited') });
  await notifyRoutineChange(await offeringIdsOf(m.id), 'A class was changed.');
  const fresh = await prisma.classMeeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  res.json(meetingView(fresh));
}));

calendarRouter.post('/meetings/:id/cancel', adminOnly, idParam, asyncHandler(async (req, res) => {
  const m = await futureMeeting(req.params.id as string);
  if (m.status === 'removed') throw new AppError('CONFLICT', 409, 'This class was removed.');
  await prisma.classMeeting.update({ where: { id: m.id }, data: { status: 'cancelled', manuallyEdited: true } });
  await audit(actorId(req), 'meeting.cancel', 'class_meeting', m.id);
  await notifyRoutineChange(await offeringIdsOf(m.id), 'A class was cancelled.');
  res.json({ ok: true });
}));

calendarRouter.delete('/meetings/:id', adminOnly, idParam, asyncHandler(async (req, res) => {
  const m = await futureMeeting(req.params.id as string);
  if (m.attendanceTakenAt) throw new AppError('MEETING_HAS_ATTENDANCE', 409, 'Attendance was taken for this class. Cancel it instead.');
  if (ymdOf(m.date) < todayDhaka()) throw new AppError('CONFLICT', 409, 'A past class cannot be deleted. Cancel it instead.');
  // manuallyEdited marks an Admin removal, so the generator never brings it back.
  await prisma.classMeeting.update({ where: { id: m.id }, data: { status: 'removed', manuallyEdited: true } });
  await audit(actorId(req), 'meeting.remove', 'class_meeting', m.id);
  await notifyRoutineChange(await offeringIdsOf(m.id), 'A class was removed.');
  res.json({ ok: true });
}));

// ───── calendar read ─────
calendarRouter.get('/calendar', adminOnly, validate({ query: calendarQuery }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof calendarQuery>;
  const [holidays, specialDays, meetings] = await Promise.all([
    prisma.holiday.findMany({ where: { startDate: { lte: dateOnly(q.to) }, endDate: { gte: dateOnly(q.from) } }, orderBy: { startDate: 'asc' } }),
    prisma.specialDay.findMany({ where: { date: { gte: dateOnly(q.from), lte: dateOnly(q.to) } }, orderBy: { date: 'asc' } }),
    prisma.classMeeting.findMany({
      where: {
        date: { gte: dateOnly(q.from), lte: dateOnly(q.to) },
        ...(q.roomId ? { roomId: q.roomId } : {}),
        ...(q.teacherId ? { OR: [{ teacherId: q.teacherId }, { substituteTeacherId: q.teacherId }] } : {}),
        ...(q.sectionId || q.groupId || q.sessionId
          ? {
              offerings: {
                some: {
                  courseOffering: {
                    ...(q.sectionId ? { sectionId: q.sectionId } : {}),
                    ...(q.groupId ? { section: { groupId: q.groupId } } : {}),
                    ...(q.sessionId ? { section: { group: { sessionId: q.sessionId } } } : {}),
                  },
                },
              },
            }
          : {}),
      },
      include: meetingInclude,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 2000,
    }),
  ]);
  res.json({ holidays: holidays.map(holidayView), specialDays: specialDays.map(specialView), meetings: meetings.map(meetingView) });
}));

