import { Router } from 'express';
import { z } from 'zod';
import { routineCopyBody, slotBody, slotPatch, id, type WeekdayName } from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { notify } from '../../lib/notify';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { generateMeetings, hhmmOf } from './generate';

/** Routine slots (04 §2). Admin edits; everyone in scope views. */
export const routineRouter = Router();
const adminOnly = requireRole('admin');
const idParam = validate({ params: z.object({ id }) });
const actorId = (req: unknown) => (req as AuthedRequest).user.id;

const slotInclude = {
  period: true,
  room: true,
  offerings: { include: { courseOffering: { include: { course: true, teacher: true, section: true } } } },
} as const;
type SlotRow = Awaited<ReturnType<typeof prisma.routineSlot.findFirstOrThrow<{ include: typeof slotInclude }>>>;

const slotView = (s: SlotRow) => ({
  id: s.id,
  day: s.day,
  period: { id: s.period.id, name: s.period.name, startTime: hhmmOf(s.period.startTime), endTime: hhmmOf(s.period.endTime) },
  room: s.room ? { id: s.room.id, name: s.room.name } : null,
  offerings: s.offerings.map((o) => ({
    id: o.courseOfferingId,
    sectionId: o.courseOffering.sectionId,
    course: { code: o.courseOffering.course.code, name: o.courseOffering.course.name },
    teacher: { id: o.courseOffering.teacherId, name: o.courseOffering.teacher.name },
  })),
});

/** Users who must hear about a change to these offerings: their teachers and active students. */
export async function affectedUsers(offeringIds: string[]): Promise<string[]> {
  if (!offeringIds.length) return [];
  const [offerings, enr] = await Promise.all([
    prisma.courseOffering.findMany({ where: { id: { in: offeringIds } }, select: { teacherId: true } }),
    prisma.enrollment.findMany({ where: { courseOfferingId: { in: offeringIds }, status: 'active' }, select: { studentId: true } }),
  ]);
  return [...new Set([...offerings.map((o) => o.teacherId), ...enr.map((e) => e.studentId)])];
}

/** One `routine_changed` notification per affected user per change batch. */
export async function notifyRoutineChange(offeringIds: string[], text = 'The class routine was updated.'): Promise<void> {
  const users = await affectedUsers(offeringIds);
  if (users.length) await notify(users, 'routine_changed', null, text);
}

async function loadOfferings(offeringIds: string[]) {
  const unique = [...new Set(offeringIds)];
  const offerings = await prisma.courseOffering.findMany({ where: { id: { in: unique } }, include: { section: { include: { group: { include: { session: true } } } } } });
  if (offerings.length !== unique.length) throw new AppError('NOT_FOUND', 404, 'Course offering not found.');
  for (const o of offerings) {
    if (o.endedAt) throw new AppError('VALIDATION_ERROR', 400, 'An offering in this slot is no longer active.', { offeringIds: 'inactive offering' });
    if (o.section.group.session.status === 'closed') throw new AppError('SESSION_CLOSED', 409, 'That session is closed.');
  }
  if (new Set(offerings.map((o) => o.teacherId)).size > 1)
    throw new AppError('COMBINED_TEACHER_MISMATCH', 400, 'A combined class must have one teacher for all its courses.');
  return offerings;
}

const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start < b.end && b.start < a.end;

/** Teacher and room double-booking by time overlap (periods may overlap). Warnings only, never a block. */
async function warningsFor(slotId: string | null, day: WeekdayName, periodId: string, roomId: string | null, teacherId: string) {
  const period = await prisma.period.findUniqueOrThrow({ where: { id: periodId } });
  const mine = { start: hhmmOf(period.startTime), end: hhmmOf(period.endTime) };
  const others = await prisma.routineSlot.findMany({
    where: { day, deletedAt: null, ...(slotId ? { id: { not: slotId } } : {}) },
    include: { period: true, offerings: { include: { courseOffering: { select: { teacherId: true } } } } },
  });
  const warnings: { type: 'teacher_double_booked' | 'room_double_booked'; slotId: string }[] = [];
  for (const o of others) {
    if (!overlaps(mine, { start: hhmmOf(o.period.startTime), end: hhmmOf(o.period.endTime) })) continue;
    if (o.offerings.some((x) => x.courseOffering.teacherId === teacherId)) warnings.push({ type: 'teacher_double_booked', slotId: o.id });
    if (roomId && o.roomId === roomId) warnings.push({ type: 'room_double_booked', slotId: o.id });
  }
  return warnings;
}

async function checkRefs(periodId?: string, roomId?: string | null) {
  if (periodId && !(await prisma.period.findFirst({ where: { id: periodId, deletedAt: null } })))
    throw new AppError('VALIDATION_ERROR', 400, 'Period not found.', { periodId: 'Not found' });
  if (roomId && !(await prisma.room.findFirst({ where: { id: roomId, deletedAt: null } })))
    throw new AppError('VALIDATION_ERROR', 400, 'Room not found.', { roomId: 'Not found' });
}

routineRouter.get('/routine', validate({ query: z.object({ sectionId: id }) }), asyncHandler(async (req, res) => {
  const { sectionId } = req.query as unknown as { sectionId: string };
  const r = req as AuthedRequest;
  if (r.user.role === 'student') {
    const me = await prisma.studentProfile.findUnique({ where: { userId: r.user.id }, select: { sectionId: true } });
    if (me?.sectionId !== sectionId) throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  } else if (r.user.role === 'teacher') {
    const ok = await prisma.section.findFirst({ where: { id: sectionId, OR: [{ mentorTeacherId: r.user.id }, { offerings: { some: { teacherId: r.user.id, endedAt: null } } }] } });
    if (!ok) throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  }
  const slots = await prisma.routineSlot.findMany({
    where: { deletedAt: null, offerings: { some: { courseOffering: { sectionId, endedAt: null } } } },
    include: slotInclude,
    orderBy: [{ day: 'asc' }, { period: { startTime: 'asc' } }],
  });
  res.json({ slots: slots.map(slotView) });
}));

routineRouter.post('/routine/slots', adminOnly, validate({ body: slotBody }), asyncHandler(async (req, res) => {
  const b = req.body as { day: WeekdayName; periodId: string; roomId?: string | null; offeringIds: string[] };
  await checkRefs(b.periodId, b.roomId);
  const offerings = await loadOfferings(b.offeringIds);
  const slot = await prisma.routineSlot.create({
    data: {
      day: b.day, periodId: b.periodId, roomId: b.roomId ?? null,
      offerings: { create: offerings.map((o) => ({ courseOfferingId: o.id })) },
    },
    include: slotInclude,
  });
  const warnings = await warningsFor(slot.id, b.day, b.periodId, b.roomId ?? null, offerings[0]!.teacherId);
  await audit(actorId(req), 'routine.slot_create', 'routine_slot', slot.id, { day: b.day, periodId: b.periodId });
  await generateMeetings();
  await notifyRoutineChange(b.offeringIds);
  res.status(201).json({ slot: slotView(slot), warnings });
}));

routineRouter.patch('/routine/slots/:id', adminOnly, idParam, validate({ body: slotPatch }), asyncHandler(async (req, res) => {
  const b = req.body as { day?: WeekdayName; periodId?: string; roomId?: string | null; offeringIds?: string[] };
  const cur = await prisma.routineSlot.findFirst({ where: { id: req.params.id, deletedAt: null }, include: { offerings: true } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Slot not found.');
  await checkRefs(b.periodId, b.roomId);
  const oldIds = cur.offerings.map((o) => o.courseOfferingId);
  const newIds = b.offeringIds ?? oldIds;
  const offerings = await loadOfferings(newIds);
  const day = b.day ?? cur.day;
  const periodId = b.periodId ?? cur.periodId;
  const roomId = b.roomId === undefined ? cur.roomId : b.roomId;
  await prisma.$transaction(async (tx) => {
    await tx.routineSlot.update({ where: { id: cur.id }, data: { day, periodId, roomId } });
    if (b.offeringIds) {
      await tx.routineSlotOffering.deleteMany({ where: { routineSlotId: cur.id } });
      await tx.routineSlotOffering.createMany({ data: offerings.map((o) => ({ routineSlotId: cur.id, courseOfferingId: o.id })) });
    }
  });
  const warnings = await warningsFor(cur.id, day, periodId, roomId, offerings[0]!.teacherId);
  await audit(actorId(req), 'routine.slot_update', 'routine_slot', cur.id, { day, periodId });
  await generateMeetings();
  await notifyRoutineChange([...new Set([...oldIds, ...newIds])]);
  const fresh = await prisma.routineSlot.findUniqueOrThrow({ where: { id: cur.id }, include: slotInclude });
  res.json({ slot: slotView(fresh), warnings });
}));

routineRouter.delete('/routine/slots/:id', adminOnly, idParam, asyncHandler(async (req, res) => {
  const cur = await prisma.routineSlot.findFirst({ where: { id: req.params.id, deletedAt: null }, include: { offerings: true } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Slot not found.');
  await prisma.routineSlot.update({ where: { id: cur.id }, data: { deletedAt: new Date() } });
  await audit(actorId(req), 'routine.slot_delete', 'routine_slot', cur.id);
  await generateMeetings(); // removes future unattended meetings of the deleted slot; past ones stay
  await notifyRoutineChange(cur.offerings.map((o) => o.courseOfferingId));
  res.json({ ok: true });
}));

routineRouter.post('/routine/copy', adminOnly, validate({ body: routineCopyBody }), asyncHandler(async (req, res) => {
  const { fromSectionId, toSectionId } = req.body as { fromSectionId: string; toSectionId: string };
  if (fromSectionId === toSectionId) throw new AppError('VALIDATION_ERROR', 400, 'Choose two different sections.', { toSectionId: 'Same section' });
  const [targetOfferings, fromSlots] = await Promise.all([
    prisma.courseOffering.findMany({ where: { sectionId: toSectionId, endedAt: null }, include: { course: true } }),
    prisma.routineSlot.findMany({
      where: { deletedAt: null, offerings: { some: { courseOffering: { sectionId: fromSectionId } } } },
      include: { offerings: { include: { courseOffering: { include: { course: true } } } } },
    }),
  ]);
  const byCourse = new Map(targetOfferings.map((o) => [o.courseId, o]));
  const skipped = new Set<string>();
  let created = 0;
  const touched: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const s of fromSlots) {
      // Only the source section's own offerings are copied; a combined slot becomes a normal slot in the target.
      const mine = s.offerings.filter((o) => o.courseOffering.sectionId === fromSectionId);
      const mapped = mine.flatMap((o) => {
        const t = byCourse.get(o.courseOffering.courseId);
        if (!t) skipped.add(o.courseOffering.course.code);
        return t ? [t] : [];
      });
      if (!mapped.length || new Set(mapped.map((m) => m.teacherId)).size > 1) {
        if (mapped.length) mapped.forEach((m) => skipped.add(m.courseId));
        continue;
      }
      await tx.routineSlot.create({
        data: { day: s.day, periodId: s.periodId, roomId: s.roomId, offerings: { create: mapped.map((m) => ({ courseOfferingId: m.id })) } },
      });
      touched.push(...mapped.map((m) => m.id));
      created++;
    }
  });
  await audit(actorId(req), 'routine.copy', 'section', toSectionId, { fromSectionId, created });
  await generateMeetings();
  await notifyRoutineChange(touched);
  res.json({ created, skippedCourses: [...skipped] });
}));
