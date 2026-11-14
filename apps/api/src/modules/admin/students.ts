import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { id, normaliseMobile, searchQuery, tabQuery } from '@cms/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { AppError, asyncHandler, validate } from '../../lib/http';
import type { AuthedRequest } from '../../middleware/session';

/** Student 360° (03 §7). Non-Admins get 404 so the feature does not even appear to exist (ACAD-12). */
export const adminStudentsRouter = Router();

const adminOr404: RequestHandler = (req, _res, next) =>
  (req as AuthedRequest).actor.role === 'admin' ? next() : next(new AppError('NOT_FOUND', 404, 'Not found.'));
adminStudentsRouter.use(adminOr404);

const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

adminStudentsRouter.get(
  '/students/search',
  validate({ query: searchQuery }),
  asyncHandler(async (req, res) => {
    const { q } = req.query as { q: string };
    const mobile = normaliseMobile(q);
    const esc = likeEscape(q);
    // login ID exact/prefix, name (trigram ILIKE), roll exact, mobile exact. Max 20.
    const items = await prisma.$queryRaw<{ id: string; name: string; loginId: string | null; roll: string; status: string; sectionId: string }[]>(Prisma.sql`
      SELECT u.id, sp.name, u.login_id AS "loginId", sp.roll, u.status::text AS status, sp.section_id AS "sectionId"
      FROM users u JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.role = 'student' AND u.status <> 'deleted' AND (
        u.login_id ILIKE ${esc + '%'} OR sp.name ILIKE ${'%' + esc + '%'} OR sp.roll = ${q} OR u.mobile = ${mobile}
      )
      ORDER BY (lower(u.login_id) = lower(${q})) DESC, sp.name ASC
      LIMIT 20`);
    res.json({ items });
  }),
);

adminStudentsRouter.get(
  '/students/:id/360',
  validate({ params: z.object({ id }), query: tabQuery }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const { tab } = req.query as { tab: string };
    const s = await prisma.studentProfile.findFirst({
      where: { userId: sid, user: { status: { not: 'deleted' } } },
      include: {
        user: { select: { loginId: true, email: true, emailVerifiedAt: true, mobile: true, status: true, createdAt: true, lastLoginAt: true, avatarId: true } },
        section: { include: { group: { include: { session: true } } } },
      },
    });
    if (!s) throw new AppError('NOT_FOUND', 404, 'Student not found.');

    if (tab === 'overview') {
      // Admin sees everything the student typed about themself, but never AI chats (PRD §5.3.1).
      return void res.json({
        tab,
        id: s.userId, name: s.name, nameLocked: s.nameLocked, roll: s.roll, bio: s.bio, dob: s.dob, address: s.address,
        guardianName: s.guardianName, guardianContact: s.guardianContact, passedOutAt: s.passedOutAt,
        loginId: s.user.loginId, email: s.user.email, emailVerified: !!s.user.emailVerifiedAt, mobile: s.user.mobile,
        status: s.user.status, createdAt: s.user.createdAt, lastLoginAt: s.user.lastLoginAt, avatarId: s.user.avatarId,
        section: {
          id: s.section.id, name: s.section.name, classLevel: s.section.classLevel,
          group: s.section.group.type, session: { id: s.section.group.sessionId, name: s.section.group.session.name, status: s.section.group.session.status },
        },
      });
    }
    if (tab === 'academic') {
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: sid, status: 'active' },
        select: {
          courseOfferingId: true, enrolledAt: true,
          courseOffering: { select: { course: { select: { id: true, code: true, name: true, isOptional: true } }, teacher: { select: { userId: true, name: true } } } },
        },
        orderBy: { enrolledAt: 'asc' },
      });
      return void res.json({
        tab,
        enrollments: enrollments.map((e) => ({
          offeringId: e.courseOfferingId, enrolledAt: e.enrolledAt, course: e.courseOffering.course,
          teacher: { id: e.courseOffering.teacher.userId, name: e.courseOffering.teacher.name },
        })),
        routine: null, // personal routine (04 §8) arrives with M5
      });
    }
    // attendance / exams / community / books / activity are built in M11 once their data exists.
    res.json({ tab, available: false });
  }),
);
