import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { prisma } from '../../db';
import { sha256 } from '../../lib/crypto';
import { createSocketServer } from '../realtime/socket';
import { captureMail, client, loginAs as rawLogin, makeAdmin, makeApp, makeStudent, makeTeacher, PW, uniq } from '../../../../../test/factories';
import { revokeAllSessions } from './sessions';

const app = makeApp();
const mail = captureMail();
let ipSeq = 0;
// Every test login comes from its own IP so the per-IP limit (20/15 min) never trips by accident.
const loginAs = (id: string, pw = PW, ip = `10.1.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`) =>
  request(app).post('/api/auth/login').set('X-Requested-With', 'cms').set('X-Forwarded-For', ip)
    .send({ identifier: id, password: pw }).then((res) => {
      const raw = (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '';
      return { res, c: client(app, raw.split(';')[0]), setCookie: raw };
    });
void rawLogin;

afterEach(() => {
  mail.clear();
  vi.useRealTimers();
});
afterAll(() => prisma.$disconnect());

/** Admin who has changed the seed password. */
async function changedAdmin() {
  const admin = await makeAdmin(prisma);
  const { res, c } = await loginAs(admin.email!);
  expect(res.body.next).toBe('change_password');
  const ch = await c.post('/api/auth/admin/change-password', { currentPassword: PW, newPassword: 'Brand-new-pass-9' });
  expect(ch.body.next).toBe('dashboard');
  return { admin, password: 'Brand-new-pass-9' };
}

describe('login', () => {
  it('[AUTH-01] unknown id and wrong password same error, similar timing', async () => {
    const t = await makeTeacher(prisma);
    const time = async (id: string) => {
      const s = performance.now();
      const { res } = await loginAs(id, 'wrong-password');
      return { ms: performance.now() - s, res };
    };
    await time(t.loginId!); // warm up argon2 + dummy hash
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = await time(t.loginId!);
      const b = await time(uniq('nobody'));
      expect(a.res.status).toBe(401);
      expect(b.res.status).toBe(401);
      expect(a.res.body).toEqual(b.res.body);
      expect(a.res.body.error.code).toBe('INVALID_CREDENTIALS');
      known.push(a.ms);
      unknown.push(b.ms);
    }
    const med = (x: number[]) => [...x].sort((p, q) => p - q)[Math.floor(x.length / 2)]!;
    const ratio = med(known) / med(unknown);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  it('[AUTH-02] passed-out / inactive blocked, message only after correct password', async () => {
    const out = await makeStudent(prisma, { status: 'passed_out' });
    const off = await makeTeacher(prisma, { status: 'inactive' });
    const wrongOut = await loginAs(out.loginId!, 'nope-nope-1');
    expect(wrongOut.res.body.error.code).toBe('INVALID_CREDENTIALS');
    const rOut = await loginAs(out.loginId!);
    expect(rOut.res.status).toBe(403);
    expect(rOut.res.body.error.code).toBe('ACCOUNT_PASSED_OUT');
    expect(rOut.res.body.error.message).toBe('Your account is inactive because your session has been completed.');
    expect(rOut.setCookie).toBe('');
    const wrongOff = await loginAs(off.loginId!, 'nope-nope-1');
    expect(wrongOff.res.body.error.code).toBe('INVALID_CREDENTIALS');
    const rOff = await loginAs(off.loginId!);
    expect(rOff.res.status).toBe(403);
    expect(rOff.res.body.error.code).toBe('ACCOUNT_INACTIVE');
    expect(await prisma.loginSession.count({ where: { userId: { in: [out.id, off.id] } } })).toBe(0);
  });

  it('login by email and case-insensitive login ID; role mismatch flagged', async () => {
    const t = await makeTeacher(prisma, { verified: true });
    const byEmail = await loginAs(t.email!.toUpperCase());
    expect(byEmail.res.status).toBe(200);
    expect(byEmail.res.body).toMatchObject({ next: 'dashboard', role: 'teacher', roleMismatch: false });
    const byId = await loginAs(t.loginId!.toLowerCase());
    expect(byId.res.status).toBe(200);
    const hinted = await request(app).post('/api/auth/login').set('X-Requested-With', 'cms')
      .set('X-Forwarded-For', '10.9.9.9').send({ identifier: t.loginId, password: PW, roleHint: 'student' });
    expect(hinted.body).toMatchObject({ role: 'teacher', roleMismatch: true, next: 'dashboard' });
  });

  it('[AUTH-09] 5 failed logins for one identifier in 15 minutes give 429', async () => {
    const t = await makeTeacher(prisma);
    for (let i = 0; i < 5; i++) expect((await loginAs(t.loginId!, 'bad-pass-word')).res.status).toBe(401);
    const blocked = await loginAs(t.loginId!, 'bad-pass-word');
    expect(blocked.res.status).toBe(429);
    expect(blocked.res.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.res.body.error.message).toMatch(/Too many attempts, try again in \d+ minutes?/);
    // even the correct password is refused while limited
    expect((await loginAs(t.loginId!)).res.status).toBe(429);
  });
});

describe('sessions and CSRF', () => {
  it('[AUTH-12] cookie flags; only hash in DB', async () => {
    const t = await makeTeacher(prisma);
    const { setCookie, res } = await loginAs(t.loginId!);
    expect(res.status).toBe(200);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const token = decodeURIComponent(setCookie.split(';')[0]!.split('=')[1]!);
    const rows = await prisma.loginSession.findMany({ where: { userId: t.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('[AUTH-12] Secure is dropped only when NODE_ENV=development', async () => {
    const t = await makeTeacher(prisma);
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    try {
      env.NODE_ENV = 'development';
      expect((await loginAs(t.loginId!)).setCookie).not.toMatch(/Secure/i);
      env.NODE_ENV = 'production';
      expect((await loginAs(t.loginId!)).setCookie).toMatch(/Secure/i);
    } finally {
      env.NODE_ENV = prev;
    }
  });

  it('[AUTH-08] write without X-Requested-With → 403', async () => {
    const t = await makeTeacher(prisma);
    const { c } = await loginAs(t.loginId!);
    const res = await request(app).post('/api/auth/logout').set('Cookie', c.cookie);
    expect(res.status).toBe(403);
    const login = await request(app).post('/api/auth/login').send({ identifier: t.loginId, password: PW });
    expect(login.status).toBe(403);
    expect((await c.get('/api/auth/me')).status).toBe(200); // reads need no header
  });

  it('me returns the user; logout revokes the session', async () => {
    const t = await makeTeacher(prisma);
    const { c } = await loginAs(t.loginId!);
    const me = await c.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ id: t.id, role: 'teacher', name: 'Test Teacher', firstLogin: false, emailVerified: false });
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    const after = await c.get('/api/auth/me');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('SESSION_ENDED');
    expect((await request(app).get('/api/auth/me')).body.error.code).toBe('UNAUTHENTICATED');
  });

  it('expired sessions are rejected; non-admin sessions slide, admin sessions do not', async () => {
    const t = await makeTeacher(prisma);
    const { c } = await loginAs(t.loginId!);
    const s = (await prisma.loginSession.findFirst({ where: { userId: t.id } }))!;
    await prisma.loginSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date(Date.now() - 11 * 60_000) } });
    await c.get('/api/auth/me');
    const slid = (await prisma.loginSession.findUnique({ where: { id: s.id } }))!;
    expect(slid.expiresAt.getTime()).toBeGreaterThan(s.expiresAt.getTime());
    await prisma.loginSession.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await c.get('/api/auth/me')).body.error.code).toBe('SESSION_ENDED');

    const a = await changedAdmin();
    const sess = (await prisma.loginSession.findFirst({ where: { userId: a.admin.id, revokedAt: null } }))!;
    expect(sess.expiresAt.getTime() - sess.createdAt.getTime()).toBeLessThanOrEqual(12 * 3600_000 + 1000);
  });

  it('[AUTH-03] deactivate → 401 next request and socket disconnected', async () => {
    const t = await makeStudent(prisma);
    const { c } = await loginAs(t.loginId!);
    const server = http.createServer(app);
    const io = createSocketServer(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const sock = connect(`http://localhost:${port}`, { extraHeaders: { Cookie: c.cookie }, transports: ['websocket'], reconnection: false });
    try {
      await new Promise<void>((res, rej) => {
        sock.on('connect', res);
        sock.on('connect_error', rej);
      });
      const revoked = new Promise<void>((res) => sock.on('session:revoked', () => res()));
      const closed = new Promise<void>((res) => sock.on('disconnect', () => res()));
      await prisma.user.update({ where: { id: t.id }, data: { status: 'inactive' } });
      expect((await c.get('/api/auth/me')).status).toBe(401); // the next request already fails
      await revokeAllSessions(t.id); // what the deactivate action in M3 calls
      await Promise.all([revoked, closed]);
      expect(sock.connected).toBe(false);
      // a new socket with the dead session is refused
      const again = connect(`http://localhost:${port}`, { extraHeaders: { Cookie: c.cookie }, transports: ['websocket'], reconnection: false });
      await new Promise<void>((res) => again.on('connect_error', () => res()));
      again.close();
    } finally {
      sock.close();
      await io.close();
    }
  });
});

describe('first login', () => {
  it('[AUTH-04] first-login user limited to auth + complete-profile', async () => {
    const t = await makeTeacher(prisma, { firstLogin: true });
    const { c, res } = await loginAs(t.loginId!);
    expect(res.body.next).toBe('complete_profile');
    const blocked = await c.get('/api/me/profile');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('FIRST_LOGIN_REQUIRED');
    expect((await c.patch('/api/me/profile', { bio: 'x' })).body.error.code).toBe('FIRST_LOGIN_REQUIRED');
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/me/complete-profile', { newPassword: 'Sup3r-secret!', mobile: '01712345678' })).status).toBe(200);
    expect((await c.get('/api/me/profile')).status).toBe(200);
  });

  it('[AUTH-10] complete-profile policy, BD mobile, verification queued, banner flag', async () => {
    const t = await makeStudent(prisma, { firstLogin: true });
    const { c } = await loginAs(t.loginId!);
    const bad = (body: object) => c.post('/api/me/complete-profile', body);
    expect((await bad({ newPassword: 'short', mobile: '01712345678' })).status).toBe(400);
    expect((await bad({ newPassword: PW, mobile: '01712345678' })).body.error.fields.newPassword).toMatch(/different/);
    expect((await bad({ newPassword: t.loginId!, mobile: '01712345678' })).body.error.fields.newPassword).toMatch(/login ID/);
    expect((await bad({ newPassword: 'password123', mobile: '01712345678' })).body.error.fields.newPassword).toMatch(/common/);
    expect((await bad({ newPassword: 'Sup3r-secret!', mobile: '12345' })).body.error.fields.mobile).toBeTruthy();
    expect((await bad({ newPassword: 'Sup3r-secret!', mobile: '01212345678' })).status).toBe(400); // 012 is not a BD mobile prefix
    expect(mail.sent).toHaveLength(0);
    const ok = await bad({ newPassword: 'Sup3r-secret!', mobile: '+8801712345678' });
    expect(ok.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ firstLogin: false, mustChangePassword: false, mobile: '01712345678' });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ priority: 'high' });
    expect(mail.sent[0]!.m.to).toBe(t.email);
    const me = await c.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ firstLogin: false, emailVerified: false }); // UI shows the banner
    expect((await c.post('/api/me/complete-profile', { newPassword: 'Another-pass-1', mobile: '01712345678' })).status).toBe(409);
    expect((await loginAs(t.loginId!, 'Sup3r-secret!')).res.status).toBe(200);
  });
});

describe('admin login', () => {
  it('[AUTH-05] admin logs in with password only; blocked until the seed password is changed; then reaches the dashboard', async () => {
    const admin = await makeAdmin(prisma);
    const first = await loginAs(admin.email!);
    expect(first.res.status).toBe(200);
    expect(first.res.body.next).toBe('change_password');
    const gated = await first.c.get('/api/me/profile');
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('FIRST_LOGIN_REQUIRED');
    expect((await first.c.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);
    expect((await first.c.post('/api/auth/admin/change-password', { currentPassword: PW, newPassword: PW })).status).toBe(400);
    expect((await first.c.post('/api/auth/admin/change-password', { currentPassword: PW, newPassword: 'Brand-new-pass-9' })).body.next).toBe('dashboard');
    expect((await first.c.get('/api/me/profile')).status).toBe(200);

    // From now on: password only, straight to the dashboard, no code step and no authenticator routes.
    const later = await loginAs(admin.email!, 'Brand-new-pass-9');
    expect(later.res.body.next).toBe('dashboard');
    expect((await later.c.get('/api/me/profile')).status).toBe(200);
    expect((await loginAs(admin.email!, PW)).res.status).toBe(401); // old seed password no longer works
  });

  it('Admin can change own password in the profile and the other sessions end', async () => {
    const a = await changedAdmin();
    const one = await loginAs(a.admin.email!, a.password);
    const two = await loginAs(a.admin.email!, a.password);
    const r = await one.c.post('/api/me/password', { currentPassword: a.password, newPassword: 'Another-pass-77' });
    expect(r.status).toBe(200);
    expect((await two.c.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs(a.admin.email!, 'Another-pass-77')).res.body.next).toBe('dashboard');
  });

  it('Admin forgot-password works with the email link alone', async () => {
    const a = await changedAdmin();
    await prisma.user.update({ where: { id: a.admin.id }, data: { emailVerifiedAt: new Date() } });
    const f = await request(app).post('/api/auth/password/forgot').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.2.9.1').send({ email: a.admin.email });
    expect(f.status).toBe(200);
    const token = new URL(mail.sent[0]!.m.link!).searchParams.get('token')!;
    const reset = await request(app).post('/api/auth/password/reset').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.2.9.2').send({ token, newPassword: 'Reset-pass-1234' });
    expect(reset.status).toBe(200);
    expect((await loginAs(a.admin.email!, 'Reset-pass-1234')).res.body.next).toBe('dashboard');
  });
});

describe('password and email flows', () => {
  const tokenFromMail = (i = 0) => new URL(mail.sent[i]!.m.link!).searchParams.get('token')!;

  it('[AUTH-07] unverified email gets no mail, same response', async () => {
    const verified = await makeTeacher(prisma, { verified: true });
    const unverified = await makeTeacher(prisma, { verified: false });
    const a = await request(app).post('/api/auth/password/forgot').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.2.0.1').send({ email: verified.email });
    const b = await request(app).post('/api/auth/password/forgot').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.2.0.2').send({ email: unverified.email });
    const c = await request(app).post('/api/auth/password/forgot').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.2.0.3').send({ email: 'nobody@x.test' });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.m.to).toBe(verified.email);
    expect(mail.sent[0]!.priority).toBe('high');
    expect(await prisma.token.count({ where: { userId: unverified.id } })).toBe(0);
  });

  it('[AUTH-06] reset token expired/reused/wrong purpose fails; reset revokes all', async () => {
    const t = await makeTeacher(prisma, { verified: true });
    const { c } = await loginAs(t.loginId!);
    const forgot = (ip: string) => request(app).post('/api/auth/password/forgot').set('X-Requested-With', 'cms').set('X-Forwarded-For', ip).send({ email: t.email });
    const reset = (token: string, newPassword = 'Fresh-pass-77') => request(app).post('/api/auth/password/reset').set('X-Requested-With', 'cms').send({ token, newPassword });

    await forgot('10.3.0.1');
    const token = tokenFromMail(0);
    const row = await prisma.token.findFirstOrThrow({ where: { userId: t.id, purpose: 'password_reset' } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(20 * 60_000);
    expect((await reset(token, 'short')).status).toBe(400); // policy failure does not burn the token
    expect((await reset(token)).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401); // all sessions revoked
    expect((await reset(token)).status).toBe(410); // reused
    expect((await loginAs(t.loginId!, 'Fresh-pass-77')).res.status).toBe(200);

    // expired
    await forgot('10.3.0.2');
    const t2 = tokenFromMail(1);
    await prisma.token.updateMany({ where: { tokenHash: sha256(t2) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await reset(t2);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('TOKEN_EXPIRED');

    // wrong purpose: an email-verify token cannot reset a password, and a reset token cannot verify email
    const vTok = 'v'.repeat(43);
    await prisma.token.create({ data: { userId: t.id, purpose: 'email_verify', tokenHash: sha256(vTok), expiresAt: new Date(Date.now() + 60_000) } });
    expect((await reset(vTok)).status).toBe(410);
    await forgot('10.3.0.3');
    const t3 = tokenFromMail(2);
    expect((await request(app).get(`/api/auth/email/verify?token=${t3}`)).status).toBe(410);
    expect((await reset('x'.repeat(43))).status).toBe(410); // unknown
  });

  it('[AUTH-11] email change link to new address, verify swaps + revokes others', async () => {
    const t = await makeTeacher(prisma, { verified: true });
    const one = await loginAs(t.loginId!);
    const two = await loginAs(t.loginId!);
    const newEmail = `${uniq('new')}@x.test`;
    const taken = await makeTeacher(prisma);
    expect((await one.c.post('/api/me/email', { newEmail, password: 'wrong-wrong-1' })).status).toBe(401);
    expect((await one.c.post('/api/me/email', { newEmail: taken.email!, password: PW })).status).toBe(409);
    expect((await one.c.post('/api/me/email', { newEmail, password: PW })).status).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.m.to).toBe(newEmail);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: t.id } })).email).toBe(t.email); // not swapped yet
    const verify = await request(app).get(`/api/auth/email/verify?token=${tokenFromMail()}`);
    expect(verify.status).toBe(302);
    expect(verify.headers.location).toBe('/profile?verified=1');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.email).toBe(newEmail);
    expect(after.emailVerifiedAt).not.toBeNull();
    expect((await one.c.get('/api/auth/me')).status).toBe(401);
    expect((await two.c.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs(newEmail)).res.status).toBe(200);
  });

  it('email verify marks verified; resend limited to 3 per day; password change keeps this session only', async () => {
    const t = await makeStudent(prisma);
    const one = await loginAs(t.loginId!);
    const two = await loginAs(t.loginId!);
    for (let i = 0; i < 3; i++) expect((await one.c.post('/api/me/email/resend-verification')).status).toBe(200);
    expect((await one.c.post('/api/me/email/resend-verification')).status).toBe(429);
    expect((await request(app).get(`/api/auth/email/verify?token=${tokenFromMail(2)}`)).status).toBe(302);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: t.id } })).emailVerifiedAt).not.toBeNull();
    expect((await one.c.post('/api/me/email/resend-verification')).status).toBe(409);

    expect((await one.c.post('/api/me/password', { currentPassword: 'nope-nope-1', newPassword: 'Another-pass-1' })).status).toBe(401);
    expect((await one.c.post('/api/me/password', { currentPassword: PW, newPassword: PW })).status).toBe(400);
    expect((await one.c.post('/api/me/password', { currentPassword: PW, newPassword: 'Another-pass-1' })).status).toBe(200);
    expect((await one.c.get('/api/auth/me')).status).toBe(200);
    expect((await two.c.get('/api/auth/me')).status).toBe(401);
  });
});

describe('profile', () => {
  it('[AUTH-13] read-only/locked fields cannot change', async () => {
    const s = await makeStudent(prisma, { nameLocked: true });
    const { c } = await loginAs(s.loginId!);
    const before = (await c.get('/api/me/profile')).body.profile;
    expect(before).toMatchObject({ name: 'Test Student', nameLocked: true, roll: '01' });

    const locked = await c.patch('/api/me/profile', { name: 'Someone Else' });
    expect(locked.status).toBe(403);
    // read-only fields are silently stripped
    const res = await c.patch('/api/me/profile', {
      bio: 'Hello', dob: '2008-05-01', address: 'Dhaka', guardianName: 'G', guardianContact: '01711111111', mobile: '01911111111',
      roll: '99', loginId: 'hacker', sectionId: 'x', nameLocked: false, status: 'inactive', role: 'admin', email: 'evil@x.test',
    });
    expect(res.status).toBe(200);
    const after = (await c.get('/api/me/profile')).body.profile;
    expect(after).toMatchObject({ bio: 'Hello', dob: '2008-05-01', address: 'Dhaka', guardianName: 'G', mobile: '01911111111' });
    expect(after).toMatchObject({ roll: '01', loginId: s.loginId, nameLocked: true, email: s.email, role: 'student' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: 'active', role: 'student', loginId: s.loginId });
    // an unlocked student can change their name
    const free = await makeStudent(prisma);
    const f = await loginAs(free.loginId!);
    expect((await f.c.patch('/api/me/profile', { name: 'New Name' })).status).toBe(200);
    expect((await f.c.get('/api/me/profile')).body.profile.name).toBe('New Name');
    // bad mobile
    expect((await f.c.patch('/api/me/profile', { mobile: '123' })).status).toBe(400);

    // teachers cannot edit designation or subjects
    const t = await makeTeacher(prisma);
    const tc = await loginAs(t.loginId!);
    const tr = await tc.c.patch('/api/me/profile', { name: 'Prof X', bio: 'b', designation: 'Principal', subjects: ['Maths'], address: 'x', dob: '2000-01-01' });
    expect(tr.status).toBe(200);
    const tp = (await tc.c.get('/api/me/profile')).body.profile;
    expect(tp).toMatchObject({ name: 'Prof X', bio: 'b', designation: 'Lecturer', subjects: ['Physics'] });
    expect(tp.address).toBeUndefined();
  });
});

describe('guards', () => {
  it('unauthenticated /api/me is 401 and unknown /api routes stay 404', async () => {
    expect((await request(app).get('/api/me/profile')).status).toBe(401);
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });

  it('the only code that ends sessions is revokeAllSessions / revoke (no stray revokedAt writes)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = path.join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (f.endsWith('.ts') && !f.endsWith('.test.ts') && /revokedAt:/.test(readFileSync(f, 'utf8'))) files.push(f);
      }
    };
    walk(root);
    expect(files.map((f) => path.basename(f))).toEqual(['sessions.ts']);
  });
});
