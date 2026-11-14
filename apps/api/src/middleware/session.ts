import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { LoginSession, User } from '@prisma/client';
import { AppError } from '../lib/http';
import type { Actor } from '../lib/permissions';
import { isLive, lookup, touch } from '../modules/auth/sessions';

export interface AuthedRequest extends Request {
  actor: Actor;
  user: User;
  session: LoginSession;
}
export const cookieName = (): string => process.env.SESSION_COOKIE_NAME ?? 'cms_session';

export function cookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    // Secure everywhere except local development over http (asserted in AUTH-12).
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax' as const,
    path: '/',
    ...(expires ? { expires } : {}),
  };
}
export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(cookieName(), cookieOptions());
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/** AUTH-08: every state-changing request must carry X-Requested-With: cms. */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE.has(req.method) || req.get('x-requested-with') === 'cms') return next();
  next(new AppError('FORBIDDEN', 403, 'Missing request header.'));
};

export const sessionMiddleware: RequestHandler = async (req, res, next) => {
  try {
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieName()];
    if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Please log in.');
    const s = await lookup(token);
    if (!s || !isLive(s)) {
      clearSessionCookie(res);
      throw new AppError('SESSION_ENDED', 401, 'Your session has ended. Please log in again.');
    }
    await touch(s);
    const r = req as AuthedRequest;
    r.session = s;
    r.user = s.user;
    r.actor = { id: s.user.id, role: s.user.role };
    next();
  } catch (e) {
    next(e);
  }
};

const FIRST_LOGIN_OK = [/^\/api\/auth\//, /^\/api\/me\/complete-profile$/];
const STEP_UP_OK = [/^\/api\/auth\/(me|logout|totp\/|login\/totp|admin\/)/];

/** First-login users may call only auth routes and complete-profile (AUTH-04). */
export const firstLoginGate: RequestHandler = (req, _res, next) => {
  const u = (req as AuthedRequest).user;
  if (u.role !== 'admin' && u.firstLogin && !FIRST_LOGIN_OK.some((r) => r.test(req.originalUrl.split('?')[0]!)))
    return next(new AppError('FIRST_LOGIN_REQUIRED', 403, 'Complete your profile first.'));
  next();
};

/** Admin with a pending step-up (or without TOTP set up) reaches only the TOTP routes (AUTH-05). */
export const stepUpGate: RequestHandler = (req, _res, next) => {
  const r = req as AuthedRequest;
  if (r.user.role === 'admin' && (r.session.stepUpPending || !r.user.totpEnabledAt)) {
    if (!STEP_UP_OK.some((x) => x.test(req.originalUrl.split('?')[0]!)))
      return next(new AppError('STEP_UP_REQUIRED', 403, 'Enter your authenticator code first.'));
  }
  next();
};

export const requireRole =
  (...roles: Actor['role'][]): RequestHandler =>
  (req, _res, next: NextFunction) =>
    roles.includes((req as AuthedRequest).actor.role) ? next() : next(new AppError('FORBIDDEN', 403, 'Not allowed.'));

export const authChain: RequestHandler[] = [sessionMiddleware, firstLoginGate, stepUpGate];
