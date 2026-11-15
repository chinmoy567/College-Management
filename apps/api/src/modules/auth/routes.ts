import { Router, type Request, type Response } from 'express';
import {
  adminChangePasswordBody, forgotBody, loginBody, resetBody,
} from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { checkPassword } from '../../lib/passwordPolicy';
import { HOUR, MIN, assertUnder, consume, hit } from '../../lib/rateLimit';
import { authChain, clearSessionCookie, cookieName, cookieOptions, type AuthedRequest } from '../../middleware/session';
import { queueEmail } from '../mail/queue';
import * as tpl from '../mail/templates';
import { createSession, revoke, revokeAllSessions } from './sessions';

const appUrl = () => process.env.APP_URL ?? '';
const ip = (req: Request) => req.ip ?? undefined;

/** Routes that need no session. Mounted before the auth chain so they can never require it by accident. */
export const publicAuthRouter = Router();
/** Routes that need a session. */
export const authedAuthRouter = Router();

type TokenPurposeName = 'password_reset' | 'email_verify' | 'email_change';

async function issueToken(userId: string, purpose: TokenPurposeName, minutes: number, newEmail?: string) {
  const raw = randomToken(32);
  await prisma.token.create({
    data: { userId, purpose, newEmail, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + minutes * 60_000) },
  });
  return raw;
}

export async function sendVerification(user: { id: string; email: string | null }): Promise<void> {
  if (!user.email) return;
  const raw = await issueToken(user.id, 'email_verify', 60 * 24);
  const link = `${appUrl()}/api/auth/email/verify?token=${raw}`;
  await queueEmail({ to: user.email, link, ...tpl.verifyEmail(link) }, 'high');
}

function setCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(cookieName(), token, cookieOptions(expiresAt));
}

// ───── login ─────
publicAuthRouter.post(
  '/login',
  validate({ body: loginBody }),
  asyncHandler(async (req, res) => {
    const { identifier, password, roleHint } = req.body as { identifier: string; password: string; roleHint?: string };
    const idKey = sha256(identifier.toLowerCase());
    await consume(`login:ip:${req.ip}`, 20, 15 * MIN);
    await assertUnder(`login:id:${idKey}`, 5, 15 * MIN);

    const user = await prisma.user.findFirst({
      where: identifier.includes('@')
        ? { email: identifier.toLowerCase() }
        : { loginId: { equals: identifier, mode: 'insensitive' } },
    });
    const ok = await verifyPassword(user?.passwordHash, password); // always runs argon2 (AUTH-01)
    const ua = req.get('user-agent')?.slice(0, 300);
    if (!user || !ok || user.status === 'deleted') {
      await hit(`login:id:${idKey}`, 15 * MIN);
      await prisma.loginHistory.create({ data: { userId: user?.id, identifierHash: idKey, success: false, ip: ip(req), userAgent: ua } });
      throw new AppError('INVALID_CREDENTIALS', 401, 'Wrong ID or password.');
    }
    if (user.status === 'inactive') throw new AppError('ACCOUNT_INACTIVE', 403, 'Your account is inactive. Contact the college office.');
    if (user.status === 'passed_out')
      throw new AppError('ACCOUNT_PASSED_OUT', 403, 'Your account is inactive because your session has been completed.');

    await prisma.loginHistory.create({ data: { userId: user.id, identifierHash: idKey, success: true, ip: ip(req), userAgent: ua } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const isAdmin = user.role === 'admin';
    const { token, session } = await createSession(user, { ip: ip(req), userAgent: ua });
    setCookie(res, token, session.expiresAt);
    if (isAdmin) {
      return res.json({ next: user.mustChangePassword ? 'change_password' : 'dashboard' });
    }
    res.json({
      next: user.firstLogin ? 'complete_profile' : 'dashboard',
      role: user.role,
      roleMismatch: !!roleHint && roleHint !== user.role,
    });
  }),
);

// ───── password reset (public) ─────
const FORGOT_MSG = 'If the email is registered and verified, a link was sent. Otherwise ask the Admin.';
publicAuthRouter.post(
  '/password/forgot',
  validate({ body: forgotBody }),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    await consume(`forgot:ip:${req.ip}`, 5, HOUR);
    await consume(`forgot:email:${sha256(email)}`, 3, HOUR);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.status === 'active' && user.emailVerifiedAt && user.email) {
      const raw = await issueToken(user.id, 'password_reset', 20);
      const link = `${appUrl()}/reset-password?token=${raw}`;
      await queueEmail({ to: user.email, link, ...tpl.resetPassword(link) }, 'high');
    }
    res.json({ message: FORGOT_MSG });
  }),
);

async function consumeToken(raw: string, purpose: TokenPurposeName) {
  const t = await prisma.token.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!t || t.purpose !== purpose) throw new AppError('TOKEN_EXPIRED', 410, 'This link is not valid.');
  if (t.usedAt || t.expiresAt < new Date()) throw new AppError('TOKEN_EXPIRED', 410, 'This link has expired or was already used.');
  // Single use: claim atomically.
  const claimed = await prisma.token.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new AppError('TOKEN_EXPIRED', 410, 'This link has expired or was already used.');
  return t;
}

publicAuthRouter.post(
  '/password/reset',
  validate({ body: resetBody }),
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    // Check the policy before burning the single-use token.
    const peek = await prisma.token.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (peek && peek.purpose === 'password_reset') {
      const bad = checkPassword(newPassword, { loginId: peek.user.loginId });
      if (bad) throw new AppError('VALIDATION_ERROR', 400, bad, { newPassword: bad });
    }
    const t = await consumeToken(token, 'password_reset');
    await prisma.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
    await revokeAllSessions(t.userId);
    res.json({ ok: true });
  }),
);

publicAuthRouter.get(
  '/email/verify',
  asyncHandler(async (req, res) => {
    const raw = String(req.query.token ?? '');
    const row = await prisma.token.findUnique({ where: { tokenHash: sha256(raw) } });
    const purpose: TokenPurposeName = row?.purpose === 'email_change' ? 'email_change' : 'email_verify';
    const t = await consumeToken(raw, purpose);
    if (purpose === 'email_change') {
      if (!t.newEmail) throw new AppError('TOKEN_EXPIRED', 410, 'This link is not valid.');
      if (await prisma.user.findUnique({ where: { email: t.newEmail } }))
        throw new AppError('CONFLICT', 409, 'That email is already in use.');
      await prisma.user.update({ where: { id: t.userId }, data: { email: t.newEmail, emailVerifiedAt: new Date() } });
      await revokeAllSessions(t.userId);
    } else {
      await prisma.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } });
    }
    res.redirect('/profile?verified=1');
  }),
);

// ───── session routes ─────
authedAuthRouter.use(...authChain);

authedAuthRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await revoke((req as AuthedRequest).session.id);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authedAuthRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const [teacher, student, sanction] = await Promise.all([
      user.role === 'teacher'
        ? prisma.teacherProfile.findUnique({ where: { userId: user.id }, include: { mentoredSection: { select: { id: true } } } })
        : null,
      user.role === 'student' ? prisma.studentProfile.findUnique({ where: { userId: user.id } }) : null,
      prisma.userSanction.findFirst({
        where: { userId: user.id, type: 'mute', liftedAt: null, endsAt: { gt: new Date() } },
        orderBy: { endsAt: 'desc' },
      }),
    ]);
    res.json({
      user: {
        id: user.id,
        role: user.role,
        name: teacher?.name ?? student?.name ?? 'Admin',
        avatarUrl: null, // signed avatar URL is added with the profile screens
        firstLogin: user.firstLogin,
        emailVerified: !!user.emailVerifiedAt,
        mustChangePassword: user.role === 'admin' ? user.mustChangePassword : undefined,
        isMentorOf: teacher?.mentoredSection?.id,
        mutedUntil: sanction?.endsAt ?? undefined,
      },
    });
  }),
);

// ───── Admin forced password change (seed password) ─────
function adminOnly(req: Request): AuthedRequest {
  const r = req as AuthedRequest;
  if (r.user.role !== 'admin') throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  return r;
}

authedAuthRouter.post(
  '/admin/change-password',
  validate({ body: adminChangePasswordBody }),
  asyncHandler(async (req, res) => {
    const r = adminOnly(req);
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    if (!(await verifyPassword(r.user.passwordHash, currentPassword))) throw new AppError('INVALID_CREDENTIALS', 401, 'Wrong password.');
    const bad = checkPassword(newPassword, { initialMatches: currentPassword === newPassword });
    if (bad) throw new AppError('VALIDATION_ERROR', 400, bad, { newPassword: bad });
    await prisma.user.update({ where: { id: r.user.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
    await revokeAllSessions(r.user.id, r.session.id);
    await audit(r.user.id, 'admin.password_change', 'user', r.user.id, undefined, ip(req));
    res.json({ next: 'dashboard' });
  }),
);
