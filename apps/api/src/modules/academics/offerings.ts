import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type CourseOffering } from '@prisma/client';
import { id, offeringCopyBody, offeringPatchBody, offeringStudentsBody, offeringsPutBody } from '@cms/shared';
import { prisma } from '../../db';
import { lockSection } from '../../lib/activeStudent';
import { audit } from '../../lib/audit';
import { chatMembership } from '../../lib/chatMembership';
import { closedSessionGuard } from '../../lib/closedSession';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { notify } from '../../lib/notify';
import { dhakaDate } from '../../lib/time';
import { type AuthedRequest, requireRole } from '../../middleware/session';

export const offeringsRouter = Router();
const idParam = z.object({ id });
const ip = (req: { ip?: string }) => req.ip ?? undefined;
type Tx = Prisma.TransactionClient;

interface Affected {
  teachers: Set<string>;
  notified: Map<string, string>; // teacherId -> text
}
const newAffected = (): Affected => ({ teachers: new Set(), notified: new Map() });

/** Students who get enrolled into a section's offerings: active, and inactive ones (they return on reactivation). */
const enrollableWhere = (sectionId: string): Prisma.StudentProfileWhereInput => ({ sectionId, user: { status: { in: ['active', 'inactive'] } } });

async function enroll(tx: Tx, offeringId: string, studentIds: string[]): Promise<void> {
  if (!studentIds.length) return;
  const existing = await tx.enrollment.findMany({ where: { courseOfferingId: offeringId, studentId: { in: studentIds }, status: 'active' }, select: { studentId: true } });
  const have = new Set(existing.map((e) => e.studentId));
  const missing = studentIds.filter((s) => !have.has(s));
  if (missing.length) await tx.enrollment.createMany({ data: missing.map((studentId) => ({ courseOfferingId: offeringId, studentId })) });
}

async function endEnrollments(tx: Tx, offeringId: string, studentIds?: string[]): Promise<void> {
  await tx.enrollment.updateMany({
    where: { courseOfferingId: offeringId, status: 'active', ...(studentIds ? { studentId: { in: studentIds } } : {}) },
    data: { status: 'ended', endedAt: new Date() },
  });
}

/** Future meetings of the offering with no attendance get the new teacher; past meetings stay (§4). */
export async function reassignFutureMeetings(tx: Tx, offeringId: string, oldTeacherId: string, newTeacherId: string): Promise<number> {
  return tx.$executeRaw(Prisma.sql`
    UPDATE class_meetings SET teacher_id = ${newTeacherId}
    WHERE teacher_id = ${oldTeacherId}
      AND status = 'scheduled'
      AND attendance_taken_at IS NULL
      AND date >= ${dhakaDate()}::date
      AND id IN (SELECT class_meeting_id FROM class_meeting_offerings WHERE course_offering_id = ${offeringId})`);
}

async function assertTeacher(tx: Tx, teacherId: string): Promise<void> {
  const t = await tx.user.findFirst({ where: { id: teacherId, role: 'teacher', status: 'active' }, select: { id: true } });
  if (!t) throw new AppError('VALIDATION_ERROR', 400, 'Choose an active teacher.', { teacherId: 'invalid' });
}

async function changeTeacher(tx: Tx, o: CourseOffering, teacherId: string, aff: Affected): Promise<void> {
  if (o.teacherId === teacherId) return;
  await assertTeacher(tx, teacherId);
  await tx.courseOffering.update({ where: { id: o.id }, data: { teacherId } });
  await reassignFutureMeetings(tx, o.id, o.teacherId, teacherId);
  aff.teachers.add(o.teacherId).add(teacherId);
  aff.notified.set(o.teacherId, 'A course was taken off your assignments.');
  aff.notified.set(teacherId, 'A course was assigned to you.');
}

async function setOptionalStudents(tx: Tx, offeringId: string, sectionId: string, wanted: string[]): Promise<void> {
  const inSection = await tx.studentProfile.findMany({ where: enrollableWhere(sectionId), select: { userId: true } });
  const valid = new Set(inSection.map((s) => s.userId));
  if (wanted.some((s) => !valid.has(s))) throw new AppError('VALIDATION_ERROR', 400, 'Choose students of this section.', { studentIds: 'invalid' });
  await endEnrollments(tx, offeringId, [...valid].filter((s) => !wanted.includes(s)));
  await enroll(tx, offeringId, wanted);
}

/** Creates (or revives an ended) offering and its enrollments. Returns how it changed. */
async function addOffering(
  tx: Tx,
  section: { id: string },
  item: { courseId: string; teacherId: string; optionalStudentIds?: string[] },
  aff: Affected,
): Promise<'created' | 'revived' | 'updated' | 'same'> {
  await assertTeacher(tx, item.teacherId);
  const course = await tx.course.findUniqueOrThrow({ where: { id: item.courseId } });
  const existing = await tx.courseOffering.findUnique({ where: { sectionId_courseId: { sectionId: section.id, courseId: item.courseId } } });
  let offering: CourseOffering;
  let kind: 'created' | 'revived' | 'updated' | 'same' = 'same';
  if (!existing) {
    offering = await tx.courseOffering.create({ data: { sectionId: section.id, courseId: item.courseId, teacherId: item.teacherId } });
    kind = 'created';
  } else if (existing.endedAt) {
    offering = await tx.courseOffering.update({ where: { id: existing.id }, data: { endedAt: null, teacherId: item.teacherId } });
    kind = 'revived';
  } else {
    offering = existing;
    if (existing.teacherId !== item.teacherId) {
      await changeTeacher(tx, existing, item.teacherId, aff);
      kind = 'updated';
    }
  }
  if (kind === 'created' || kind === 'revived') {
    aff.teachers.add(item.teacherId);
    aff.notified.set(item.teacherId, 'A course was assigned to you.');
  }
  if (kind === 'created' || kind === 'revived' || course.isOptional) {
    const everyone = (await tx.studentProfile.findMany({ where: enrollableWhere(section.id), select: { userId: true } })).map((s) => s.userId);
    if (course.isOptional && item.optionalStudentIds) await setOptionalStudents(tx, offering.id, section.id, item.optionalStudentIds);
    else if (kind !== 'same' && kind !== 'updated') await enroll(tx, offering.id, everyone);
  }
  return kind;
}

async function finishAffected(tx: Tx, aff: Affected, sectionId: string): Promise<void> {
  await chatMembership.syncMany(aff.teachers, tx);
  for (const [teacherId, text] of aff.notified) await notify([teacherId], 'course_assignment_changed', { type: 'section', id: sectionId }, text, tx);
}

async function endOffering(tx: Tx, o: CourseOffering, aff: Affected): Promise<void> {
  const running = await tx.examAttempt.count({ where: { status: 'in_progress', exam: { courseOfferingId: o.id } } });
  if (running > 0) throw new AppError('ATTEMPT_IN_PROGRESS', 409, 'An exam of this course is running. End the course after it finishes.');
  await tx.courseOffering.update({ where: { id: o.id }, data: { endedAt: new Date() } });
  await endEnrollments(tx, o.id);
  aff.teachers.add(o.teacherId);
  aff.notified.set(o.teacherId, 'A course was taken off your assignments.');
}

type SectionCtx = { id: string; classLevel: number; group: { type: 'science' | 'commerce' | 'arts' } };
const courseFits = (c: { groupType: string; classLevel: string }, s: SectionCtx): boolean =>
  (c.groupType === s.group.type || c.groupType === 'common') && (c.classLevel === 'both' || c.classLevel === `c${s.classLevel}`);

async function loadSection(tx: Tx, sectionId: string): Promise<SectionCtx> {
  const locked = await lockSection(tx, sectionId);
  if (!locked || locked.deleted) throw new AppError('NOT_FOUND', 404, 'Section not found.');
  await closedSessionGuard({ sectionId }, tx);
  return tx.section.findUniqueOrThrow({ where: { id: sectionId }, select: { id: true, classLevel: true, group: { select: { type: true } } } });
}

// ───── routes ─────
offeringsRouter.get(
  '/sections/:id/course-suggestions',
  requireRole('admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const sec = await prisma.section.findFirst({ where: { id: sid, deletedAt: null }, select: { classLevel: true, group: { select: { type: true } } } });
    if (!sec) throw new AppError('NOT_FOUND', 404, 'Section not found.');
    const [courses, offered] = await Promise.all([
      prisma.course.findMany({
        where: {
          archivedAt: null,
          groupType: { in: [sec.group.type, 'common'] },
          classLevel: { in: [sec.classLevel === 11 ? 'c11' : 'c12', 'both'] },
        },
        orderBy: { code: 'asc' },
      }),
      prisma.courseOffering.findMany({ where: { sectionId: sid, endedAt: null }, select: { courseId: true, id: true, teacherId: true } }),
    ]);
    const map = new Map(offered.map((o) => [o.courseId, o]));
    res.json({ items: courses.map((c) => ({ ...c, offered: map.has(c.id), offeringId: map.get(c.id)?.id ?? null, teacherId: map.get(c.id)?.teacherId ?? null })) });
  }),
);

offeringsRouter.put(
  '/sections/:id/offerings',
  requireRole('admin'),
  validate({ params: idParam, body: offeringsPutBody }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const { items } = req.body as z.infer<typeof offeringsPutBody>;
    const actor = (req as AuthedRequest).actor;
    if (new Set(items.map((i) => i.courseId)).size !== items.length)
      throw new AppError('VALIDATION_ERROR', 400, 'A course can be listed once.', { items: 'duplicate_course' });
    const summary = await prisma.$transaction(
      async (tx) => {
        const section = await loadSection(tx, sid);
        const courses = await tx.course.findMany({ where: { id: { in: items.map((i) => i.courseId) } } });
        const byId = new Map(courses.map((c) => [c.id, c]));
        for (const it of items) {
          const c = byId.get(it.courseId);
          if (!c || c.archivedAt || !courseFits(c, section))
            throw new AppError('VALIDATION_ERROR', 400, 'A listed course does not fit this section.', { courseId: it.courseId });
          if (it.optionalStudentIds && !c.isOptional)
            throw new AppError('VALIDATION_ERROR', 400, 'Only optional courses take a student list.', { optionalStudentIds: it.courseId });
        }
        const aff = newAffected();
        const counts = { created: 0, updated: 0, ended: 0 };
        for (const it of items) {
          const kind = await addOffering(tx, section, it, aff);
          if (kind === 'created' || kind === 'revived') counts.created++;
          if (kind === 'updated') counts.updated++;
        }
        const keep = new Set(items.map((i) => i.courseId));
        const running = await tx.courseOffering.findMany({ where: { sectionId: sid, endedAt: null } });
        for (const o of running) {
          if (keep.has(o.courseId)) continue;
          await endOffering(tx, o, aff);
          counts.ended++;
        }
        await finishAffected(tx, aff, sid);
        await audit(actor.id, 'section.offerings', 'section', sid, counts, ip(req), tx);
        return counts;
      },
      { timeout: 30_000 },
    );
    res.json(summary);
  }),
);

offeringsRouter.patch(
  '/offerings/:id',
  requireRole('admin'),
  validate({ params: idParam, body: offeringPatchBody }),
  asyncHandler(async (req, res) => {
    const { id: oid } = req.params as { id: string };
    const { teacherId } = req.body as { teacherId: string };
    const actor = (req as AuthedRequest).actor;
    await prisma.$transaction(async (tx) => {
      const o = await tx.courseOffering.findUnique({ where: { id: oid } });
      if (!o || o.endedAt) throw new AppError('NOT_FOUND', 404, 'Offering not found.');
      await loadSection(tx, o.sectionId);
      const aff = newAffected();
      await changeTeacher(tx, o, teacherId, aff);
      await finishAffected(tx, aff, o.sectionId);
      await audit(actor.id, 'offering.teacher_change', 'offering', oid, undefined, ip(req), tx);
    });
    res.json({ ok: true });
  }),
);

offeringsRouter.post(
  '/sections/:id/offerings/copy',
  requireRole('admin'),
  validate({ params: idParam, body: offeringCopyBody }),
  asyncHandler(async (req, res) => {
    const { id: targetId } = req.params as { id: string };
    const { fromSectionId } = req.body as { fromSectionId: string };
    const actor = (req as AuthedRequest).actor;
    const out = await prisma.$transaction(async (tx) => {
      const target = await loadSection(tx, targetId);
      const source = await tx.section.findFirst({ where: { id: fromSectionId, deletedAt: null }, select: { id: true } });
      if (!source) throw new AppError('NOT_FOUND', 404, 'Source section not found.');
      const candidates = await tx.courseOffering.findMany({
        where: { sectionId: fromSectionId, endedAt: null, teacher: { user: { status: 'active' } }, course: { archivedAt: null } },
        include: { course: true },
      });
      const aff = newAffected();
      let copied = 0;
      let skipped = 0;
      for (const o of candidates) {
        if (!courseFits(o.course, target)) {
          skipped++;
          continue;
        }
        const kind = await addOffering(tx, target, { courseId: o.courseId, teacherId: o.teacherId }, aff);
        if (kind === 'created' || kind === 'revived') copied++;
        else skipped++;
      }
      await finishAffected(tx, aff, targetId);
      await audit(actor.id, 'section.offerings_copy', 'section', targetId, { fromSectionId, copied, skipped }, ip(req), tx);
      return { copied, skipped };
    });
    res.json(out);
  }),
);

offeringsRouter.put(
  '/offerings/:id/students',
  requireRole('admin'),
  validate({ params: idParam, body: offeringStudentsBody }),
  asyncHandler(async (req, res) => {
    const { id: oid } = req.params as { id: string };
    const { studentIds } = req.body as { studentIds: string[] };
    const actor = (req as AuthedRequest).actor;
    await prisma.$transaction(async (tx) => {
      const o = await tx.courseOffering.findUnique({ where: { id: oid }, include: { course: true } });
      if (!o || o.endedAt) throw new AppError('NOT_FOUND', 404, 'Offering not found.');
      await loadSection(tx, o.sectionId);
      if (!o.course.isOptional) throw new AppError('VALIDATION_ERROR', 400, 'Only optional courses take a student list.');
      await setOptionalStudents(tx, oid, o.sectionId, [...new Set(studentIds)]);
      await audit(actor.id, 'offering.students', 'offering', oid, { count: studentIds.length }, ip(req), tx);
    });
    res.json({ ok: true });
  }),
);

/** Re-used by account creation and moves: enroll a student in every running offering of a section. */
export async function enrollInSection(tx: Tx, studentId: string, sectionId: string): Promise<void> {
  const offerings = await tx.courseOffering.findMany({ where: { sectionId, endedAt: null }, select: { id: true } });
  if (offerings.length) await tx.enrollment.createMany({ data: offerings.map((o) => ({ courseOfferingId: o.id, studentId })) });
}
