import { Router } from 'express';
import { z } from 'zod';
import { SECTION_MAX, closeSessionBody, id, sectionCreateBody, sectionPatchBody, sessionBody } from '@cms/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { ACTIVE_STUDENT_WHERE, activeStudentCount, lockSection } from '../../lib/activeStudent';
import { audit } from '../../lib/audit';
import { chatMembership } from '../../lib/chatMembership';
import { closedSessionGuard } from '../../lib/closedSession';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { notify } from '../../lib/notify';
import { permissionsFor } from '../../lib/permissions';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { closeSession } from '../users/passOut';

export const sessionsRouter = Router();
const idParam = z.object({ id });
const ip = (req: { ip?: string }) => req.ip ?? undefined;

const sectionSelect = {
  id: true,
  name: true,
  classLevel: true,
  mentorTeacherId: true,
  _count: { select: { students: { where: ACTIVE_STUDENT_WHERE } } },
} as const;

// ───── sessions ─────
sessionsRouter.get(
  '/sessions',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const actor = (req as AuthedRequest).actor;
    const teacherScope: Prisma.SessionWhereInput =
      actor.role === 'admin'
        ? {}
        : {
            groups: {
              some: {
                sections: {
                  some: { deletedAt: null, OR: [{ mentorTeacherId: actor.id }, { offerings: { some: { teacherId: actor.id, endedAt: null } } }] },
                },
              },
            },
          };
    const sessions = await prisma.session.findMany({
      where: teacherScope,
      orderBy: { createdAt: 'desc' },
      include: { groups: { orderBy: { type: 'asc' }, include: { sections: { where: { deletedAt: null }, orderBy: [{ classLevel: 'asc' }, { name: 'asc' }], select: sectionSelect } } } },
    });
    res.json({
      items: sessions.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        closedAt: s.closedAt,
        groups: s.groups.map((g) => ({
          id: g.id,
          type: g.type,
          sectionCount: g.sections.length,
          studentCount: g.sections.reduce((n, x) => n + x._count.students, 0),
          sections: g.sections.map((x) => ({
            id: x.id, name: x.name, classLevel: x.classLevel, mentorTeacherId: x.mentorTeacherId, studentCount: x._count.students,
          })),
        })),
      })),
    });
  }),
);

sessionsRouter.post(
  '/sessions',
  requireRole('admin'),
  validate({ body: sessionBody }),
  asyncHandler(async (req, res) => {
    const { name } = req.body as { name: string };
    const actor = (req as AuthedRequest).actor;
    if (await prisma.session.findUnique({ where: { name } }))
      throw new AppError('CONFLICT', 409, 'A session with this name already exists.', { name: 'duplicate' });
    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.session.create({ data: { name } });
      const groups = [];
      for (const type of ['science', 'commerce', 'arts'] as const) {
        const group = await tx.group.create({ data: { sessionId: session.id, type } });
        const section = await tx.section.create({ data: { groupId: group.id, classLevel: 11, name: 'A' } });
        await chatMembership.ensureConversation(tx, 'group', group.id);
        await chatMembership.ensureConversation(tx, 'section', section.id);
        groups.push({ id: group.id, type, sections: [{ id: section.id, name: 'A', classLevel: 11 }] });
      }
      await audit(actor.id, 'session.create', 'session', session.id, { groups: 3 }, ip(req), tx);
      return { id: session.id, name: session.name, status: session.status, groups };
    });
    res.status(201).json(created);
  }),
);

sessionsRouter.patch(
  '/sessions/:id',
  requireRole('admin'),
  validate({ params: idParam, body: sessionBody }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const { name } = req.body as { name: string };
    const actor = (req as AuthedRequest).actor;
    await prisma.$transaction(async (tx) => {
      if (!(await tx.session.findUnique({ where: { id: sid } }))) throw new AppError('NOT_FOUND', 404, 'Session not found.');
      await closedSessionGuard({ sessionId: sid }, tx);
      const dup = await tx.session.findFirst({ where: { name, id: { not: sid } } });
      if (dup) throw new AppError('CONFLICT', 409, 'A session with this name already exists.', { name: 'duplicate' });
      await tx.session.update({ where: { id: sid }, data: { name } });
      await audit(actor.id, 'session.rename', 'session', sid, undefined, ip(req), tx);
    });
    res.json({ ok: true });
  }),
);

sessionsRouter.post(
  '/sessions/:id/close',
  requireRole('admin'),
  validate({ params: idParam, body: closeSessionBody }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const result = await closeSession((req as AuthedRequest).actor.id, sid, ip(req));
    res.json(result);
  }),
);

// ───── sections ─────
sessionsRouter.post(
  '/groups/:id/sections',
  requireRole('admin'),
  validate({ params: idParam, body: sectionCreateBody }),
  asyncHandler(async (req, res) => {
    const { id: gid } = req.params as { id: string };
    const { name, classLevel } = req.body as { name: string; classLevel: 11 | 12 };
    const actor = (req as AuthedRequest).actor;
    const section = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM groups WHERE id = ${gid} FOR UPDATE`);
      if (!locked[0]) throw new AppError('NOT_FOUND', 404, 'Group not found.');
      await closedSessionGuard({ groupId: gid }, tx);
      if (await tx.section.findFirst({ where: { groupId: gid, classLevel, name: { equals: name, mode: 'insensitive' }, deletedAt: null } }))
        throw new AppError('CONFLICT', 409, 'This group already has a section with that name for this class.', { name: 'duplicate' });
      const s = await tx.section.create({ data: { groupId: gid, classLevel, name } });
      await chatMembership.ensureConversation(tx, 'section', s.id);
      await audit(actor.id, 'section.create', 'section', s.id, { classLevel }, ip(req), tx);
      return s;
    });
    res.status(201).json({ id: section.id, name: section.name, classLevel: section.classLevel, groupId: gid });
  }),
);

/** Assign, replace or clear the Section Mentor in one transaction (§2). */
export async function setMentor(actorId: string, sectionId: string, teacherId: string | null, ipAddr?: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sec = await lockSection(tx, sectionId);
    if (!sec || sec.deleted) throw new AppError('NOT_FOUND', 404, 'Section not found.');
    await closedSessionGuard({ sectionId }, tx);
    const current = await tx.section.findUniqueOrThrow({ where: { id: sectionId }, select: { mentorTeacherId: true } });
    if (current.mentorTeacherId === teacherId) return;
    if (teacherId) {
      const t = await tx.user.findFirst({ where: { id: teacherId, role: 'teacher', status: 'active' }, select: { id: true } });
      if (!t) throw new AppError('VALIDATION_ERROR', 400, 'Choose an active teacher.', { mentorTeacherId: 'invalid' });
      const other = await tx.section.findFirst({ where: { mentorTeacherId: teacherId, id: { not: sectionId } }, select: { id: true } });
      if (other) throw new AppError('CONFLICT', 409, 'This teacher already mentors another section.', { mentorTeacherId: 'already_mentor' });
    }
    // A teacher mentors one section only: clear the old holder first so the unique index never trips.
    await tx.section.update({ where: { id: sectionId }, data: { mentorTeacherId: null } });
    if (teacherId) await tx.section.update({ where: { id: sectionId }, data: { mentorTeacherId: teacherId } });
    await chatMembership.syncMany([current.mentorTeacherId, teacherId].filter((x): x is string => !!x), tx);
    await audit(actorId, 'section.mentor', 'section', sectionId, { assigned: !!teacherId, replaced: !!current.mentorTeacherId }, ipAddr, tx);
    if (teacherId) await notify([teacherId], 'mentor_assigned', { type: 'section', id: sectionId }, 'You are now the Section Mentor of a section.', tx);
    if (current.mentorTeacherId) await notify([current.mentorTeacherId], 'mentor_assigned', { type: 'section', id: sectionId }, 'You are no longer the Section Mentor of a section.', tx);
  });
}

sessionsRouter.patch(
  '/sections/:id',
  requireRole('admin'),
  validate({ params: idParam, body: sectionPatchBody }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const body = req.body as { name?: string; mentorTeacherId?: string | null };
    const actor = (req as AuthedRequest).actor;
    if (body.name !== undefined) {
      await prisma.$transaction(async (tx) => {
        const sec = await tx.section.findFirst({ where: { id: sid, deletedAt: null } });
        if (!sec) throw new AppError('NOT_FOUND', 404, 'Section not found.');
        await closedSessionGuard({ sectionId: sid }, tx);
        if (await tx.section.findFirst({ where: { groupId: sec.groupId, classLevel: sec.classLevel, name: { equals: body.name!, mode: 'insensitive' }, deletedAt: null, id: { not: sid } } }))
          throw new AppError('CONFLICT', 409, 'This group already has a section with that name for this class.', { name: 'duplicate' });
        await tx.section.update({ where: { id: sid }, data: { name: body.name } });
        await audit(actor.id, 'section.rename', 'section', sid, undefined, ip(req), tx);
      });
    }
    if (body.mentorTeacherId !== undefined) await setMentor(actor.id, sid, body.mentorTeacherId, ip(req));
    res.json({ ok: true });
  }),
);

sessionsRouter.delete(
  '/sections/:id',
  requireRole('admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const actor = (req as AuthedRequest).actor;
    await prisma.$transaction(async (tx) => {
      const sec = await lockSection(tx, sid);
      if (!sec || sec.deleted) throw new AppError('NOT_FOUND', 404, 'Section not found.');
      await closedSessionGuard({ sectionId: sid }, tx);
      const active = await activeStudentCount(tx, sid);
      const withContent = await tx.courseOffering.count({
        where: {
          sectionId: sid,
          OR: [{ materials: { some: {} } }, { exams: { some: {} } }, { recordedClasses: { some: {} } }, { attendanceRecords: { some: {} } }, { onlineClassOfferings: { some: {} } }],
        },
      });
      if (active > 0 || withContent > 0)
        throw new AppError('SECTION_NOT_EMPTY', 409, 'This section still has active students or course content.');
      const mentor = (await tx.section.findUniqueOrThrow({ where: { id: sid }, select: { mentorTeacherId: true } })).mentorTeacherId;
      await tx.section.update({ where: { id: sid }, data: { deletedAt: new Date(), mentorTeacherId: null } });
      const teachers = await tx.courseOffering.findMany({ where: { sectionId: sid, endedAt: null }, select: { teacherId: true } });
      await tx.courseOffering.updateMany({ where: { sectionId: sid, endedAt: null }, data: { endedAt: new Date() } });
      await chatMembership.syncMany([...teachers.map((t) => t.teacherId), ...(mentor ? [mentor] : [])], tx);
      await audit(actor.id, 'section.delete', 'section', sid, undefined, ip(req), tx);
    });
    res.json({ ok: true });
  }),
);

sessionsRouter.get(
  '/sections/:id',
  requireRole('admin', 'teacher'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const actor = (req as AuthedRequest).actor;
    const perms = permissionsFor(req);
    const sec = await prisma.section.findFirst({
      where: { id: sid, deletedAt: null },
      include: { group: { include: { session: true } }, mentor: { select: { userId: true, name: true } } },
    });
    const allowed = !!sec && (actor.role === 'admin' || (await perms.mentorsSection(actor, sid)) || (await perms.teachesInSection(actor, sid)));
    if (!sec || !allowed) throw new AppError('NOT_FOUND', 404, 'Section not found.');
    const [students, offerings] = await Promise.all([
      prisma.studentProfile.findMany({
        where: { sectionId: sid, user: { status: { in: ['active', 'inactive'] } } },
        orderBy: { roll: 'asc' },
        select: { userId: true, name: true, roll: true, user: { select: { loginId: true, status: true, avatarId: true } } },
      }),
      prisma.courseOffering.findMany({
        where: { sectionId: sid, endedAt: null },
        include: { course: true, teacher: { select: { userId: true, name: true } } },
      }),
    ]);
    const activeCount = students.filter((s) => s.user.status === 'active').length;
    res.json({
      id: sec.id,
      name: sec.name,
      classLevel: sec.classLevel,
      group: { id: sec.groupId, type: sec.group.type },
      session: { id: sec.group.sessionId, name: sec.group.session.name, status: sec.group.session.status },
      mentor: sec.mentor ? { id: sec.mentor.userId, name: sec.mentor.name } : null,
      freePlaces: Math.max(0, SECTION_MAX - activeCount),
      students: students.map((s) => ({ id: s.userId, name: s.name, roll: s.roll, loginId: s.user.loginId, status: s.user.status, avatarId: s.user.avatarId })),
      offerings: offerings.map((o) => ({
        id: o.id,
        course: { id: o.course.id, code: o.course.code, name: o.course.name, isOptional: o.course.isOptional },
        teacher: { id: o.teacher.userId, name: o.teacher.name },
      })),
    });
  }),
);

/** Admin dashboard alert: sections without a mentor (§2). */
sessionsRouter.get(
  '/alerts/sections-without-mentor',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const items = await prisma.section.findMany({
      where: { deletedAt: null, mentorTeacherId: null, group: { session: { status: 'active' } } },
      select: { id: true, name: true, classLevel: true, group: { select: { type: true, session: { select: { name: true } } } } },
    });
    res.json({ items });
  }),
);
