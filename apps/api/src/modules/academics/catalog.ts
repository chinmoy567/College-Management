import { Router } from 'express';
import { z } from 'zod';
import { chapterBody, chapterOrderBody, chapterPatchBody, courseBody, coursePatchBody, id } from '@cms/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { type AuthedRequest, requireRole } from '../../middleware/session';

export const catalogRouter = Router();
const idParam = z.object({ id });
const ip = (req: { ip?: string }) => req.ip ?? undefined;

/** Course ids the actor may see: Admin all; teachers their offerings; students their active enrollments. */
async function visibleCourseWhere(req: AuthedRequest): Promise<Prisma.CourseWhereInput> {
  const a = req.actor;
  if (a.role === 'admin') return {};
  if (a.role === 'teacher') return { offerings: { some: { teacherId: a.id, endedAt: null } } };
  return { offerings: { some: { endedAt: null, enrollments: { some: { studentId: a.id, status: 'active' } } } } };
}

// ───── courses ─────
catalogRouter.get(
  '/courses',
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const where = await visibleCourseWhere(r);
    const items = await prisma.course.findMany({
      where: { ...where, ...(r.actor.role === 'admin' ? {} : { archivedAt: null }) },
      orderBy: [{ groupType: 'asc' }, { code: 'asc' }],
    });
    res.json({ items });
  }),
);

catalogRouter.post(
  '/courses',
  requireRole('admin'),
  validate({ body: courseBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof courseBody>;
    if (await prisma.course.findUnique({ where: { code: b.code } }))
      throw new AppError('CONFLICT', 409, 'A course with this code already exists.', { code: 'duplicate' });
    const course = await prisma.$transaction(async (tx) => {
      const c = await tx.course.create({ data: b });
      await audit((req as AuthedRequest).actor.id, 'course.create', 'course', c.id, { groupType: b.groupType, classLevel: b.classLevel }, ip(req), tx);
      return c;
    });
    res.status(201).json(course);
  }),
);

catalogRouter.patch(
  '/courses/:id',
  requireRole('admin'),
  validate({ params: idParam, body: coursePatchBody }),
  asyncHandler(async (req, res) => {
    const { id: cid } = req.params as { id: string };
    const { archived, ...fields } = req.body as z.infer<typeof coursePatchBody>;
    const course = await prisma.$transaction(async (tx) => {
      const cur = await tx.course.findUnique({ where: { id: cid } });
      if (!cur) throw new AppError('NOT_FOUND', 404, 'Course not found.');
      if (fields.code && fields.code !== cur.code && (await tx.course.findUnique({ where: { code: fields.code } })))
        throw new AppError('CONFLICT', 409, 'A course with this code already exists.', { code: 'duplicate' });
      // A used course is archived instead of being changed under running offerings' feet.
      const c = await tx.course.update({
        where: { id: cid },
        data: { ...fields, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) },
      });
      await audit((req as AuthedRequest).actor.id, 'course.update', 'course', cid, { fields: Object.keys(fields), archived: archived ?? null }, ip(req), tx);
      return c;
    });
    res.json(course);
  }),
);

// ───── chapters ─────
async function canSeeCourse(req: AuthedRequest, courseId: string): Promise<boolean> {
  const where = await visibleCourseWhere(req);
  return !!(await prisma.course.findFirst({ where: { id: courseId, ...where }, select: { id: true } }));
}

catalogRouter.get(
  '/courses/:id/chapters',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id: cid } = req.params as { id: string };
    if (!(await canSeeCourse(req as AuthedRequest, cid))) throw new AppError('NOT_FOUND', 404, 'Course not found.');
    const items = await prisma.chapter.findMany({ where: { courseId: cid }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, order: true } });
    res.json({ items });
  }),
);

catalogRouter.post(
  '/courses/:id/chapters',
  requireRole('admin', 'teacher'),
  validate({ params: idParam, body: chapterBody }),
  asyncHandler(async (req, res) => {
    const { id: cid } = req.params as { id: string };
    const { name, order } = req.body as { name: string; order?: number };
    const actor = (req as AuthedRequest).actor;
    const course = await prisma.course.findUnique({ where: { id: cid } });
    if (!course) throw new AppError('NOT_FOUND', 404, 'Course not found.');
    if (actor.role === 'teacher') {
      // "Add a chapter to their own course" (PRD §5.13): a teacher of a running offering of this course.
      const teaches = await prisma.courseOffering.findFirst({
        where: { courseId: cid, teacherId: actor.id, endedAt: null, section: { group: { session: { status: 'active' } } } },
        select: { id: true },
      });
      if (!teaches) throw new AppError('FORBIDDEN', 403, 'You do not teach this course.');
    }
    const chapter = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM courses WHERE id = ${cid} FOR UPDATE`);
      if (await tx.chapter.findUnique({ where: { courseId_name: { courseId: cid, name } } }))
        throw new AppError('CONFLICT', 409, 'This course already has a chapter with that name.', { name: 'duplicate' });
      const max = await tx.chapter.aggregate({ where: { courseId: cid }, _max: { order: true } });
      const ch = await tx.chapter.create({ data: { courseId: cid, name, order: order ?? (max._max.order ?? 0) + 1, createdById: actor.id } });
      if (actor.role === 'admin') await audit(actor.id, 'chapter.create', 'chapter', ch.id, undefined, ip(req), tx);
      return ch;
    });
    res.status(201).json({ id: chapter.id, name: chapter.name, order: chapter.order });
  }),
);

catalogRouter.patch(
  '/chapters/:id',
  requireRole('admin'),
  validate({ params: idParam, body: chapterPatchBody }),
  asyncHandler(async (req, res) => {
    const { id: chid } = req.params as { id: string };
    const { name } = req.body as { name: string };
    await prisma.$transaction(async (tx) => {
      const ch = await tx.chapter.findUnique({ where: { id: chid } });
      if (!ch) throw new AppError('NOT_FOUND', 404, 'Chapter not found.');
      if (await tx.chapter.findFirst({ where: { courseId: ch.courseId, name, id: { not: chid } } }))
        throw new AppError('CONFLICT', 409, 'This course already has a chapter with that name.', { name: 'duplicate' });
      await tx.chapter.update({ where: { id: chid }, data: { name } });
      await audit((req as AuthedRequest).actor.id, 'chapter.rename', 'chapter', chid, undefined, ip(req), tx);
    });
    res.json({ ok: true });
  }),
);

catalogRouter.delete(
  '/chapters/:id',
  requireRole('admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id: chid } = req.params as { id: string };
    await prisma.$transaction(async (tx) => {
      const ch = await tx.chapter.findUnique({
        where: { id: chid },
        include: { _count: { select: { recordedClasses: true, materials: true, questions: true, examQuestions: true } } },
      });
      if (!ch) throw new AppError('NOT_FOUND', 404, 'Chapter not found.');
      if (Object.values(ch._count).some((n) => n > 0)) throw new AppError('CHAPTER_IN_USE', 409, 'This chapter is used by content and cannot be deleted.');
      await tx.chapter.delete({ where: { id: chid } });
      await audit((req as AuthedRequest).actor.id, 'chapter.delete', 'chapter', chid, undefined, ip(req), tx);
    });
    res.json({ ok: true });
  }),
);

catalogRouter.put(
  '/courses/:id/chapters/order',
  requireRole('admin'),
  validate({ params: idParam, body: chapterOrderBody }),
  asyncHandler(async (req, res) => {
    const { id: cid } = req.params as { id: string };
    const { ids } = req.body as { ids: string[] };
    await prisma.$transaction(async (tx) => {
      const existing = await tx.chapter.findMany({ where: { courseId: cid }, select: { id: true } });
      const same = existing.length === ids.length && new Set(ids).size === ids.length && existing.every((c) => ids.includes(c.id));
      if (!same) throw new AppError('VALIDATION_ERROR', 400, 'Send every chapter of the course exactly once.', { ids: 'mismatch' });
      for (const [i, chapterId] of ids.entries()) await tx.chapter.update({ where: { id: chapterId }, data: { order: i + 1 } });
      await audit((req as AuthedRequest).actor.id, 'chapter.reorder', 'course', cid, { count: ids.length }, ip(req), tx);
    });
    res.json({ ok: true });
  }),
);
