import { Router } from 'express';
import { z } from 'zod';
import { periodBody, periodPatch, replaceBody, roomBody, roomPatch, dhakaDate, id } from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { dateOnly, generateMeetings, hhmmOf, timeDate } from './generate';

/** Periods and rooms (04 §1). Reads: any signed-in user. Writes: Admin only. */
export const setupRouter = Router();
const adminOnly = requireRole('admin');
const idParam = validate({ params: z.object({ id }) });
const actorId = (req: unknown) => (req as AuthedRequest).user.id;

const periodView = (p: { id: string; name: string; startTime: Date; endTime: Date }) => ({
  id: p.id, name: p.name, startTime: hhmmOf(p.startTime), endTime: hhmmOf(p.endTime),
});

setupRouter.get('/periods', asyncHandler(async (_req, res) => {
  const rows = await prisma.period.findMany({ where: { deletedAt: null }, orderBy: { startTime: 'asc' } });
  res.json({ periods: rows.map(periodView) });
}));

setupRouter.post('/periods', adminOnly, validate({ body: periodBody }), asyncHandler(async (req, res) => {
  const b = req.body as { name: string; startTime: string; endTime: string };
  const p = await prisma.period.create({ data: { name: b.name, startTime: timeDate(b.startTime), endTime: timeDate(b.endTime) } });
  await audit(actorId(req), 'period.create', 'period', p.id, { startTime: b.startTime, endTime: b.endTime });
  res.status(201).json(periodView(p));
}));

setupRouter.patch('/periods/:id', adminOnly, idParam, validate({ body: periodPatch }), asyncHandler(async (req, res) => {
  const b = req.body as { name?: string; startTime?: string; endTime?: string };
  const cur = await prisma.period.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Period not found.');
  const start = b.startTime ?? hhmmOf(cur.startTime);
  const end = b.endTime ?? hhmmOf(cur.endTime);
  if (end <= start) throw new AppError('VALIDATION_ERROR', 400, 'End time must be after start time.', { endTime: 'End time must be after start time' });
  const p = await prisma.period.update({ where: { id: cur.id }, data: { name: b.name, startTime: timeDate(start), endTime: timeDate(end) } });
  await audit(actorId(req), 'period.update', 'period', p.id, { startTime: start, endTime: end });
  await generateMeetings(); // future unattended meetings pick up the new times; past meetings keep their copied times
  res.json(periodView(p));
}));

setupRouter.delete('/periods/:id', adminOnly, idParam, validate({ body: replaceBody }), asyncHandler(async (req, res) => {
  const { replacementPeriodId } = req.body as { replacementPeriodId?: string };
  const period = await prisma.period.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!period) throw new AppError('NOT_FOUND', 404, 'Period not found.');
  const slots = await prisma.routineSlot.findMany({
    where: { periodId: period.id, deletedAt: null },
    select: { id: true, day: true, offerings: { select: { courseOffering: { select: { section: { select: { name: true, classLevel: true } }, course: { select: { code: true } } } } } } },
  });
  if (slots.length && !replacementPeriodId)
    return void res.status(409).json({
      error: { code: 'PERIOD_IN_USE', message: 'This period is used in the routine. Choose a replacement period.' },
      slots: slots.map((s) => ({ id: s.id, day: s.day })),
    });
  if (replacementPeriodId) {
    if (replacementPeriodId === period.id || !(await prisma.period.findFirst({ where: { id: replacementPeriodId, deletedAt: null } })))
      throw new AppError('VALIDATION_ERROR', 400, 'Replacement period is not valid.', { replacementPeriodId: 'Not valid' });
  }
  await prisma.$transaction(async (tx) => {
    if (replacementPeriodId) await tx.routineSlot.updateMany({ where: { periodId: period.id, deletedAt: null }, data: { periodId: replacementPeriodId } });
    const days = await tx.specialDay.findMany({ where: { periodIds: { has: period.id } } });
    for (const d of days) await tx.specialDay.update({ where: { id: d.id }, data: { periodIds: d.periodIds.filter((x) => x !== period.id) } });
    await tx.period.update({ where: { id: period.id }, data: { deletedAt: new Date() } });
    await audit(actorId(req), 'period.delete', 'period', period.id, { replacementPeriodId: replacementPeriodId ?? null }, undefined, tx);
  });
  await generateMeetings();
  res.json({ ok: true, movedSlots: replacementPeriodId ? slots.length : 0 });
}));

// ───── rooms ─────
setupRouter.get('/rooms', asyncHandler(async (_req, res) => {
  res.json({ rooms: await prisma.room.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, capacity: true, building: true } }) });
}));

setupRouter.post('/rooms', adminOnly, validate({ body: roomBody }), asyncHandler(async (req, res) => {
  const b = req.body as { name: string; capacity?: number | null; building?: string | null };
  const r = await prisma.room.create({ data: { name: b.name, capacity: b.capacity ?? null, building: b.building ?? null } });
  await audit(actorId(req), 'room.create', 'room', r.id, { capacity: r.capacity });
  res.status(201).json(r);
}));

setupRouter.patch('/rooms/:id', adminOnly, idParam, validate({ body: roomPatch }), asyncHandler(async (req, res) => {
  const cur = await prisma.room.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Room not found.');
  const b = req.body as { name?: string; capacity?: number | null; building?: string | null };
  const r = await prisma.room.update({ where: { id: cur.id }, data: { name: b.name, capacity: b.capacity, building: b.building } });
  await audit(actorId(req), 'room.update', 'room', r.id, { capacity: r.capacity });
  res.json(r);
}));

setupRouter.delete('/rooms/:id', adminOnly, idParam, validate({ body: replaceBody }), asyncHandler(async (req, res) => {
  const { replacementRoomId } = req.body as { replacementRoomId?: string };
  const room = await prisma.room.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!room) throw new AppError('NOT_FOUND', 404, 'Room not found.');
  const slots = await prisma.routineSlot.findMany({ where: { roomId: room.id, deletedAt: null }, select: { id: true, day: true } });
  if (slots.length && !replacementRoomId)
    return void res.status(409).json({
      error: { code: 'ROOM_IN_USE', message: 'This room is used in the routine. Choose a replacement room.' },
      slots,
    });
  if (replacementRoomId && (replacementRoomId === room.id || !(await prisma.room.findFirst({ where: { id: replacementRoomId, deletedAt: null } }))))
    throw new AppError('VALIDATION_ERROR', 400, 'Replacement room is not valid.', { replacementRoomId: 'Not valid' });
  await prisma.$transaction(async (tx) => {
    if (replacementRoomId) await tx.routineSlot.updateMany({ where: { roomId: room.id, deletedAt: null }, data: { roomId: replacementRoomId } });
    await tx.room.update({ where: { id: room.id }, data: { deletedAt: new Date() } });
    await audit(actorId(req), 'room.delete', 'room', room.id, { replacementRoomId: replacementRoomId ?? null }, undefined, tx);
  });
  await generateMeetings();
  res.json({ ok: true, movedSlots: replacementRoomId ? slots.length : 0 });
}));

/** Rooms × periods grid for a date from scheduled/held meetings; double-booking is flagged, never blocked. */
setupRouter.get('/rooms/usage', adminOnly, validate({ query: z.object({ date: dhakaDate }) }), asyncHandler(async (req, res) => {
  const date = (req.query as unknown as { date: string }).date;
  const [rooms, periods, meetings] = await Promise.all([
    prisma.room.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.period.findMany({ where: { deletedAt: null }, orderBy: { startTime: 'asc' } }),
    prisma.classMeeting.findMany({
      where: { date: dateOnly(date), status: { in: ['scheduled', 'held'] }, roomId: { not: null } },
      select: { id: true, roomId: true, periodId: true, startTime: true, endTime: true },
    }),
  ]);
  const cells = rooms.flatMap((r) =>
    periods.map((p) => {
      const used = meetings.filter((m) => m.roomId === r.id && m.periodId === p.id);
      return { roomId: r.id, periodId: p.id, used: used.length > 0, meetingIds: used.map((m) => m.id), doubleBooked: used.length > 1 };
    }),
  );
  // Overlapping (not identical) periods in one room are also a double booking.
  for (const r of rooms) {
    const mine = meetings.filter((m) => m.roomId === r.id);
    for (const a of mine) for (const b of mine) {
      if (a.id < b.id && hhmmOf(a.startTime) < hhmmOf(b.endTime) && hhmmOf(b.startTime) < hhmmOf(a.endTime))
        for (const m of [a, b]) {
          const c = cells.find((x) => x.roomId === r.id && x.periodId === m.periodId);
          if (c) c.doubleBooked = true;
        }
    }
  }
  res.json({ date, rooms, periods: periods.map(periodView), cells });
}));

