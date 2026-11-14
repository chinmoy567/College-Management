import { Router } from 'express';
import {
  changeEmailBody, changePasswordBody, completeProfileBody, studentProfileUpdate, teacherProfileUpdate,
} from '@cms/shared';
import { prisma } from '../../db';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { checkPassword } from '../../lib/passwordPolicy';
import { DAY, consume } from '../../lib/rateLimit';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { sendVerification } from '../auth/routes';
import { revokeAllSessions } from '../auth/sessions';
import { queueEmail } from '../mail/queue';
import * as tpl from '../mail/templates';

export const meRouter = Router();

meRouter.post(
  '/complete-profile',
  requireRole('teacher', 'student'),
  validate({ body: completeProfileBody }),
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    if (!r.user.firstLogin) throw new AppError('CONFLICT', 409, 'Profile already completed.');
    const { newPassword, mobile } = req.body as { newPassword: string; mobile: string };
    const initialMatches = await verifyPassword(r.user.passwordHash, newPassword);
    const bad = checkPassword(newPassword, { loginId: r.user.loginId, initialMatches });
    if (bad) throw new AppError('VALIDATION_ERROR', 400, bad, { newPassword: bad });
    const user = await prisma.user.update({
      where: { id: r.user.id },
      data: { passwordHash: await hashPassword(newPassword), mobile, firstLogin: false, mustChangePassword: false },
    });
    await revokeAllSessions(user.id, r.session.id);
    await sendVerification(user);
    res.json({ ok: true, emailVerified: !!user.emailVerifiedAt });
  }),
);

meRouter.post(
  '/password',
  validate({ body: changePasswordBody }),
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    if (!(await verifyPassword(r.user.passwordHash, currentPassword))) throw new AppError('INVALID_CREDENTIALS', 401, 'Wrong password.');
    const bad = checkPassword(newPassword, { loginId: r.user.loginId, initialMatches: currentPassword === newPassword });
    if (bad) throw new AppError('VALIDATION_ERROR', 400, bad, { newPassword: bad });
    await prisma.user.update({ where: { id: r.user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    await revokeAllSessions(r.user.id, r.session.id);
    res.json({ ok: true });
  }),
);

meRouter.post(
  '/email',
  validate({ body: changeEmailBody }),
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const { newEmail, password } = req.body as { newEmail: string; password: string };
    if (!(await verifyPassword(r.user.passwordHash, password))) throw new AppError('INVALID_CREDENTIALS', 401, 'Wrong password.');
    if (await prisma.user.findUnique({ where: { email: newEmail } })) throw new AppError('CONFLICT', 409, 'That email is already in use.');
    const raw = randomToken(32);
    await prisma.token.create({
      data: { userId: r.user.id, purpose: 'email_change', newEmail, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    const link = `${process.env.APP_URL}/api/auth/email/verify?token=${raw}`;
    await queueEmail({ to: newEmail, link, ...tpl.changeEmail(link) }, 'high'); // sent to the NEW address
    res.json({ ok: true });
  }),
);

meRouter.post(
  '/email/resend-verification',
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    if (r.user.emailVerifiedAt) throw new AppError('CONFLICT', 409, 'Email already verified.');
    await consume(`verify-resend:${r.user.id}`, 3, DAY);
    await sendVerification(r.user);
    res.json({ ok: true });
  }),
);

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

meRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const base = {
      loginId: r.user.loginId, email: r.user.email, emailVerified: !!r.user.emailVerifiedAt, mobile: r.user.mobile, role: r.user.role,
    };
    if (r.user.role === 'student') {
      const s = await prisma.studentProfile.findUniqueOrThrow({
        where: { userId: r.user.id },
        include: { section: { include: { group: { include: { session: true } } } } },
      });
      return res.json({
        profile: {
          ...base, name: s.name, nameLocked: s.nameLocked, bio: s.bio, dob: isoDate(s.dob), address: s.address,
          guardianName: s.guardianName, guardianContact: s.guardianContact, roll: s.roll,
          section: s.section.name, classLevel: s.section.classLevel, group: s.section.group.type, session: s.section.group.session.name,
        },
      });
    }
    if (r.user.role === 'teacher') {
      const t = await prisma.teacherProfile.findUniqueOrThrow({ where: { userId: r.user.id } });
      return res.json({ profile: { ...base, name: t.name, bio: t.bio, designation: t.designation, subjects: t.subjects } });
    }
    res.json({ profile: base });
  }),
);

meRouter.patch(
  '/profile',
  requireRole('teacher', 'student'),
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const isStudent = r.user.role === 'student';
    // Read-only fields are absent from the schema, so they are stripped (AUTH-13).
    const parsed = (isStudent ? studentProfileUpdate : teacherProfileUpdate).parse(req.body ?? {}) as Record<string, unknown>;
    const { mobile, ...rest } = parsed;
    if (isStudent) {
      const s = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: r.user.id } });
      if (rest.name !== undefined && s.nameLocked && rest.name !== s.name)
        throw new AppError('FORBIDDEN', 403, 'Your name is locked. Ask the Admin to change it.');
      const data = { ...rest };
      if (typeof data.dob === 'string') data.dob = new Date(`${data.dob}T00:00:00Z`);
      await prisma.studentProfile.update({ where: { userId: r.user.id }, data });
    } else if (Object.keys(rest).length) {
      await prisma.teacherProfile.update({ where: { userId: r.user.id }, data: rest });
    }
    if (typeof mobile === 'string') await prisma.user.update({ where: { id: r.user.id }, data: { mobile } });
    res.json({ ok: true });
  }),
);
