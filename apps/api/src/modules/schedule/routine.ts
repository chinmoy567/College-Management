import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { UPLOAD_LIMITS, routineCopyBody, slotBody, slotPatch, id, type WeekdayName } from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { closedSessionGuard } from '../../lib/closedSession';
import { signMany, softDeleteObjects, storeUpload, type UploadedFile } from '../../lib/files';
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

/** Who may view a section's routine: Admin, its students, its mentor and its course teachers. */
async function assertCanViewSection(r: AuthedRequest, sectionId: string): Promise<void> {
  if (r.user.role === 'student') {
    const me = await prisma.studentProfile.findUnique({ where: { userId: r.user.id }, select: { sectionId: true } });
    if (me?.sectionId !== sectionId) throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  } else if (r.user.role === 'teacher') {
    const ok = await prisma.section.findFirst({ where: { id: sectionId, OR: [{ mentorTeacherId: r.user.id }, { offerings: { some: { teacherId: r.user.id, endedAt: null } } }] } });
    if (!ok) throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  }
}

routineRouter.get('/routine', validate({ query: z.object({ sectionId: id }) }), asyncHandler(async (req, res) => {
  const { sectionId } = req.query as unknown as { sectionId: string };
  await assertCanViewSection(req as AuthedRequest, sectionId);
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

// ───── routine image/PDF upload (PRD 5.17 alternative; 04 §2) ─────
const uploadParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMITS.documentBytes, files: 1, fields: 5, fieldSize: 1_000 } }).single('file');
const uploadMw: RequestHandler = (req, res, next) =>
  uploadParser(req, res, (e: unknown) => (e ? next(new AppError('VALIDATION_ERROR', 400, 'Send one image or PDF, 20 MB at most.', { file: 'upload' })) : next()));

const uploadView = (u: { id: string; createdAt: Date }, file: { mime: string; originalName: string | null }, url: string | undefined) => ({
  id: u.id, createdAt: u.createdAt, mime: file.mime, name: file.originalName, url: url ?? null,
});

routineRouter.post('/routine/upload', adminOnly, uploadMw, validate({ body: z.object({ sectionId: id }) }), asyncHandler(async (req, res) => {
  const { sectionId } = req.body as { sectionId: string };
  const file = (req as unknown as { file?: UploadedFile }).file;
  if (!file) throw new AppError('VALIDATION_ERROR', 400, 'Choose a file.', { file: 'required' });
  const section = await prisma.section.findFirst({ where: { id: sectionId, deletedAt: null }, select: { id: true } });
  if (!section) throw new AppError('NOT_FOUND', 404, 'Section not found.');
  await closedSessionGuard({ sectionId });
  const fileId = await storeUpload(actorId(req), 'routine_file', 'routine', file);
  // One routine file per section: a new upload replaces the old one.
  const old = await prisma.routineUpload.findMany({ where: { sectionId, deletedAt: null }, select: { id: true, fileId: true } });
  const row = await prisma.$transaction(async (tx) => {
    if (old.length) {
      await tx.routineUpload.updateMany({ where: { id: { in: old.map((o) => o.id) } }, data: { deletedAt: new Date() } });
      await softDeleteObjects(old.map((o) => o.fileId), tx);
    }
    return tx.routineUpload.create({ data: { sectionId, fileId }, include: { file: true } });
  });
  await audit(actorId(req), 'routine.upload', 'section', sectionId, { uploadId: row.id });
  const offerings = await prisma.courseOffering.findMany({ where: { sectionId, endedAt: null }, select: { id: true } });
  await notifyRoutineChange(offerings.map((o) => o.id), 'A new class routine file was uploaded.');
  const urls = await signMany([fileId]);
  res.status(201).json({ upload: uploadView(row, row.file, urls.get(fileId)) });
}));

routineRouter.get('/routine/uploads', validate({ query: z.object({ sectionId: id }) }), asyncHandler(async (req, res) => {
  const { sectionId } = req.query as unknown as { sectionId: string };
  await assertCanViewSection(req as AuthedRequest, sectionId);
  const rows = await prisma.routineUpload.findMany({ where: { sectionId, deletedAt: null, file: { deletedAt: null } }, include: { file: true }, orderBy: { createdAt: 'desc' } });
  const urls = await signMany(rows.map((r) => r.fileId));
  res.json({ uploads: rows.map((r) => uploadView(r, r.file, urls.get(r.fileId))) });
}));

routineRouter.delete('/routine/upload/:id', adminOnly, idParam, asyncHandler(async (req, res) => {
  const cur = await prisma.routineUpload.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Upload not found.');
  await closedSessionGuard({ sectionId: cur.sectionId });
  await prisma.$transaction(async (tx) => {
    await tx.routineUpload.update({ where: { id: cur.id }, data: { deletedAt: new Date() } });
    await softDeleteObjects([cur.fileId], tx);
  });
  await audit(actorId(req), 'routine.upload_delete', 'section', cur.sectionId, { uploadId: cur.id });
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
