import { Router } from 'express';
import { z } from 'zod';
import { id } from '@cms/shared';
import { prisma } from '../../db';
import { authorOf, loadAuthors, mentorLabel } from '../../lib/authorLine';
import { asyncHandler, validate } from '../../lib/http';
import { NOT_FOUND } from './common';

/** `GET /api/users/:id/public` (06 §7). Built field by field so a private column can never leak by accident. */
export const publicProfileRouter = Router();

const sectionSel = { select: { name: true, classLevel: true, group: { select: { type: true, session: { select: { name: true } } } } } } as const;

publicProfileRouter.get(
  '/:id/public',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    const uid = (req.params as { id: string }).id;
    const u = await prisma.user.findUnique({
      where: { id: uid },
      select: {
        id: true, role: true, status: true, anonymisedAt: true,
        student: { select: { bio: true, section: sectionSel } },
        teacher: { select: { bio: true, mentoredSection: sectionSel } },
      },
    });
    if (!u || u.status === 'deleted' || u.anonymisedAt) throw NOT_FOUND();
    const a = authorOf(await loadAuthors([uid]), uid);
    if (u.status !== 'active') {
      res.json({ id: uid, name: a.name, avatarUrl: a.avatarUrl, inactiveNote: 'This account is no longer active.' });
      return;
    }
    const base = { id: uid, name: a.name, avatarUrl: a.avatarUrl, role: u.role, line: a.line };
    if (u.role === 'student' && u.student) {
      const s = u.student.section;
      res.json({ ...base, bio: u.student.bio, session: s.group.session.name, group: s.group.type, section: s.name, classLevel: s.classLevel });
      return;
    }
    if (u.role === 'teacher' && u.teacher) {
      const offerings = await prisma.courseOffering.findMany({ where: { teacherId: uid, endedAt: null }, select: { course: { select: { name: true } } } });
      res.json({
        ...base,
        bio: u.teacher.bio,
        coursesTaught: [...new Set(offerings.map((o) => o.course.name))].sort(),
        mentorOf: u.teacher.mentoredSection ? mentorLabel(u.teacher.mentoredSection) : null,
      });
      return;
    }
    res.json(base);
  }),
);
