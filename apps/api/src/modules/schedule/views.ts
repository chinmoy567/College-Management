import { Router } from 'express';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { dhakaDate, formatDhaka } from '../../lib/time';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { meetingView } from './calendar';
import { dateOnly, hhmmOf } from './generate';

/** Routine views for the signed-in student or teacher (04 §8). */
export const viewsRouter = Router();

const slotInclude = {
  period: true,
  room: true,
  offerings: { include: { courseOffering: { include: { course: true, teacher: true } } } },
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
  res.json({
    slots: slots.map((s) => ({
      id: s.id,
      day: s.day,
      period: { id: s.period.id, name: s.period.name, startTime: hhmmOf(s.period.startTime), endTime: hhmmOf(s.period.endTime) },
      room: s.room ? { id: s.room.id, name: s.room.name } : null,
      offerings: s.offerings
        .filter((o) => mine.has(o.courseOfferingId))
        .map((o) => ({ id: o.courseOfferingId, course: { code: o.courseOffering.course.code, name: o.courseOffering.course.name }, teacher: { id: o.courseOffering.teacherId, name: o.courseOffering.teacher.name } })),
    })),
    substituteMeetings: extra.map(meetingView),
  });
}));

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
