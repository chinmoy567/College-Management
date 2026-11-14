import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, User } from '@prisma/client';
import { hashPassword } from '../apps/api/src/lib/crypto';
import { createApp } from '../apps/api/src/app';
import { createSession } from '../apps/api/src/modules/auth/sessions';
import { cookieName } from '../apps/api/src/middleware/session';
import { setEmailSink, type EmailMessage } from '../apps/api/src/modules/mail/queue';

/** Env the API needs; set once for integration tests. */
export function testEnv(): void {
  process.env.TOTP_ENC_KEY ||= randomBytes(32).toString('base64');
  process.env.APP_URL ||= 'http://localhost:3000';
  process.env.SESSION_COOKIE_NAME ||= 'cms_session';
}

let n = 0;
export const uniq = (p: string): string => `${p}${process.pid}${Date.now().toString(36)}${++n}`;
export const PW = 'Initial-pass-1';

export interface MailBox {
  sent: { m: EmailMessage; priority: string }[];
  clear(): void;
}
export function captureMail(): MailBox {
  const box: MailBox = { sent: [], clear: () => (box.sent.length = 0) };
  setEmailSink(async (m, priority) => void box.sent.push({ m, priority }));
  return box;
}

export function makeApp(): Express {
  testEnv();
  return createApp({ logger: undefined });
}

export async function makeAdmin(prisma: PrismaClient, o: Partial<{ password: string; mustChangePassword: boolean }> = {}): Promise<User> {
  return prisma.user.create({
    data: {
      role: 'admin', email: `${uniq('admin')}@x.test`, passwordHash: await hashPassword(o.password ?? PW),
      mustChangePassword: o.mustChangePassword ?? true,
    },
  });
}

export async function makeSection(prisma: PrismaClient) {
  const session = await prisma.session.create({ data: { name: uniq('sess') } });
  const group = await prisma.group.create({ data: { sessionId: session.id, type: 'science' } });
  return prisma.section.create({ data: { groupId: group.id, classLevel: 11, name: 'A' } });
}

export async function makeTeacher(
  prisma: PrismaClient,
  o: Partial<{ firstLogin: boolean; verified: boolean; status: 'active' | 'inactive' | 'passed_out'; email: string }> = {},
): Promise<User> {
  const loginId = uniq('T');
  return prisma.user.create({
    data: {
      role: 'teacher', loginId, email: o.email ?? `${loginId.toLowerCase()}@x.test`,
      emailVerifiedAt: o.verified ? new Date() : null, passwordHash: await hashPassword(PW),
      firstLogin: o.firstLogin ?? false, mustChangePassword: o.firstLogin ?? false, status: o.status ?? 'active',
      teacher: { create: { name: 'Test Teacher', designation: 'Lecturer', subjects: ['Physics'] } },
    },
  });
}

export async function makeStudent(
  prisma: PrismaClient,
  o: Partial<{ firstLogin: boolean; verified: boolean; status: 'active' | 'inactive' | 'passed_out'; nameLocked: boolean }> = {},
): Promise<User> {
  const section = await makeSection(prisma);
  const loginId = uniq('S');
  return prisma.user.create({
    data: {
      role: 'student', loginId, email: `${loginId.toLowerCase()}@x.test`,
      emailVerifiedAt: o.verified ? new Date() : null, passwordHash: await hashPassword(PW),
      firstLogin: o.firstLogin ?? false, mustChangePassword: o.firstLogin ?? false, status: o.status ?? 'active',
      student: { create: { name: 'Test Student', nameLocked: o.nameLocked ?? false, sectionId: section.id, roll: '01' } },
    },
  });
}

/** supertest helper that carries the session cookie by hand (Secure cookies are not replayed over http). */
export function client(app: Express, cookie = '') {
  const c = {
    cookie,
    req(method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: object, headers: Record<string, string> = {}) {
      const r = request(app)[method](url).set('X-Requested-With', 'cms');
      if (c.cookie) r.set('Cookie', c.cookie);
      for (const [k, v] of Object.entries(headers)) r.set(k, v);
      return body ? r.send(body) : r;
    },
    get: (url: string) => c.req('get', url),
    post: (url: string, body: object = {}) => c.req('post', url, body),
    patch: (url: string, body: object = {}) => c.req('patch', url, body),
    put: (url: string, body: object = {}) => c.req('put', url, body),
    delete: (url: string, body: object = {}) => c.req('delete', url, body),
  };
  return c;
}

export async function loginAs(app: Express, identifier: string, password = PW) {
  const res = await request(app).post('/api/auth/login').set('X-Requested-With', 'cms').send({ identifier, password });
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '';
  return { res, c: client(app, raw.split(';')[0]), setCookie: raw };
}

/** A signed-in client for any existing user, without going through the login rate limits. */
export async function clientFor(app: Express, user: User) {
  const { token } = await createSession(user, { stepUpPending: false });
  return client(app, `${cookieName()}=${token}`);
}

/** Admin who finished password change and TOTP set-up, with a live session. */
export async function adminClient(prisma: PrismaClient, app: Express) {
  const admin = await prisma.user.create({
    data: {
      role: 'admin', email: `${uniq('admin')}@x.test`, passwordHash: await hashPassword(PW),
      mustChangePassword: false, totpEnabledAt: new Date(), firstLogin: false,
    },
  });
  return { admin, c: await clientFor(app, admin) };
}
