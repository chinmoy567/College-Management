import { Router } from 'express';
import type { z } from 'zod';
import { myMeetingsQuery } from '@cms/shared';
import { prisma } from '../../db';
import { signMany } from '../../lib/files';
import { asyncHandler, validate } from '../../lib/http';
import { dhakaDate, formatDhaka } from '../../lib/time';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { meetingInclude, meetingView } from './calendar';
import { addDays, dateOnly, hhmmOf } from './generate';
import { weekdayOf } from '../../lib/time';

/** Routine views for the signed-in student or teacher (04 §8). */
export const viewsRouter = Router();

const slotInclude = {
  period: true,
  room: true,
  offerings: { include: { courseOffering: { include: { course: true, teacher: true, section: true } } } },
} as const;

async function offeringIdsFor(r: AuthedRequest): Promise<string[]> {
  if (r.user.role === 'student')
    return (await prisma.enrollment.findMany({ where: { studentId: r.user.id, status: 'active', courseOffering: { endedAt: null } }, select: { courseOfferingId: true } })).map((e) => e.courseOfferingId);
  return (await prisma.courseOffering.findMany({ where: { teacherId: r.user.id, endedAt: null }, select: { id: true } })).map((o) => o.id);
}

viewsRouter.get('/me/week', requireRole('student', 'teacher'), asyncHandler(async (req, res) => {
  const r = req as AuthedRequest;
  const ids = await offeringIdsFor(r);
  const slots = await prisma.routineSlot.findMany({
    where: { deletedAt: null, offerings: { some: { courseOfferingId: { in: ids } } } },
    include: slotInclude,
    orderBy: [{ day: 'asc' }, { period: { startTime: 'asc' } }],
  });
  const mine = new Set(ids);
  const today = dhakaDate();
  const extra =
    r.user.role === 'teacher'
      ? await prisma.classMeeting.findMany({
          where: { substituteTeacherId: r.user.id, date: { gte: dateOnly(today) }, status: 'scheduled' },
          include: { period: true, room: true, teacher: { select: { userId: true, name: true } }, substituteTeacher: { select: { userId: true, name: true } }, offerings: { include: { courseOffering: { include: { course: true, section: { include: { group: true } } } } } } },
          orderBy: { date: 'asc' },
        })
      : [];
  // Dated meetings of this Dhaka week (Sun–Sat) so one-off changes (cancelled, moved, extra, substitute) show on the week views too.
  const weekFrom = addDays(today, -weekdayOf(today));
  const weekMeetings =
    r.user.role === 'student'
      ? await prisma.classMeeting.findMany({
          where: {
            status: { in: ['scheduled', 'held', 'cancelled'] },
            offerings: { some: { courseOfferingId: { in: ids } } },
            OR: [
              { date: { gte: dateOnly(weekFrom), lte: dateOnly(addDays(weekFrom, 6)) } },
              { originalDate: { gte: dateOnly(weekFrom), lte: dateOnly(addDays(weekFrom, 6)) } },
            ],
          },
          include: meetingInclude,
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
          take: 300,
        })
      : [];
  res.json({
    weekFrom,
    weekMeetings: weekMeetings.map(meetingView).map((m) => ({ ...m, offerings: m.offerings.filter((o) => mine.has(o.id)) })),
    slots: slots.map((s) => ({
      id: s.id,
      day: s.day,
      period: { id: s.period.id, name: s.period.name, startTime: hhmmOf(s.period.startTime), endTime: hhmmOf(s.period.endTime) },
      room: s.room ? { id: s.room.id, name: s.room.name } : null,
      offerings: s.offerings
        .filter((o) => mine.has(o.courseOfferingId))
        .map((o) => ({ id: o.courseOfferingId, section: `Class ${o.courseOffering.section.classLevel} · ${o.courseOffering.section.name}`, course: { code: o.courseOffering.course.code, name: o.courseOffering.course.name }, teacher: { id: o.courseOffering.teacherId, name: o.courseOffering.teacher.name } })),
    })),
    substituteMeetings: extra.map(meetingView),
    routineFiles: await routineFilesFor(r),
  });
}));

/** The Admin's uploaded routine image/PDF for the student's own section (04 §2). Teachers get none here. */
async function routineFilesFor(r: AuthedRequest): Promise<{ id: string; mime: string; name: string | null; url: string | null }[]> {
  if (r.user.role !== 'student') return [];
  const me = await prisma.studentProfile.findUnique({ where: { userId: r.user.id }, select: { sectionId: true } });
  if (!me?.sectionId) return [];
  const rows = await prisma.routineUpload.findMany({ where: { sectionId: me.sectionId, deletedAt: null, file: { deletedAt: null } }, include: { file: true }, orderBy: { createdAt: 'desc' } });
  const urls = await signMany(rows.map((x) => x.fileId));
  return rows.map((x) => ({ id: x.id, mime: x.file.mime, name: x.file.originalName, url: urls.get(x.fileId) ?? null }));
}

viewsRouter.get('/me/today', requireRole('student', 'teacher'), asyncHandler(async (req, res) => {
  const r = req as AuthedRequest;
  const ids = await offeringIdsFor(r);
  const today = dhakaDate();
  const nowHm = formatDhaka(new Date(), 'HH:mm');
  const [holiday, meetings] = await Promise.all([
    prisma.holiday.findFirst({ where: { startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) } } }),
    prisma.classMeeting.findMany({
      where: {
        date: dateOnly(today),
        status: { in: ['scheduled', 'held', 'cancelled'] },
        OR: [{ offerings: { some: { courseOfferingId: { in: ids } } } }, ...(r.user.role === 'teacher' ? [{ substituteTeacherId: r.user.id }] : [])],
      },
      include: { period: true, room: true, teacher: { select: { userId: true, name: true } }, substituteTeacher: { select: { userId: true, name: true } }, offerings: { include: { courseOffering: { include: { course: true, section: { include: { group: true } } } } } } },
      orderBy: { startTime: 'asc' },
    }),
  ]);
  const views = meetings.map(meetingView).map((m) => ({
    ...m,
    current: m.status !== 'cancelled' && m.startTime <= nowHm && nowHm < m.endTime,
    next: false,
  }));
  const next = views.find((m) => m.status !== 'cancelled' && m.startTime > nowHm);
  if (next) next.next = true;
  res.json({ date: today, holiday: holiday ? { id: holiday.id, title: holiday.title } : null, meetings: views });
}));

/** The teacher's own dated meetings (as teacher or substitute) for a range, with whether attendance was taken (04 §8, SCH-21). */
viewsRouter.get('/me/meetings', requireRole('teacher'), validate({ query: myMeetingsQuery }), asyncHandler(async (req, res) => {
  const r = req as AuthedRequest;
  const q = req.query as unknown as z.infer<typeof myMeetingsQuery>;
  const meetings = await prisma.classMeeting.findMany({
    where: {
      date: { gte: dateOnly(q.from), lte: dateOnly(q.to) },
      status: { in: ['scheduled', 'held', 'cancelled'] },
      OR: [{ teacherId: r.user.id }, { substituteTeacherId: r.user.id }],
    },
    include: meetingInclude,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    take: 500,
  });
  res.json({ meetings: meetings.map(meetingView) });
}));
