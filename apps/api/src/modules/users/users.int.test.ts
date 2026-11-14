import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { captureMail, client } from '../../../../../test/factories';
import { adminClient, clientFor, fillStudents, makeApp, makeCourse, makeSessionViaApi, makeTeacher, uniq } from '../../../../../test/m3kit';
import { AUDIT_DENY_KEYS, audit } from '../../lib/audit';
import { generatePassword } from '../../lib/passwordGen';

const app = makeApp();
const mailbox = captureMail();
let admin: Awaited<ReturnType<typeof adminClient>>;
beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterAll(() => prisma.$disconnect());

const mail = (p = 'u') => `${uniq(p).toLowerCase()}@x.test`;
const newStudent = (sectionId: string, extra: object = {}) =>
  admin.c.post('/api/users/students', { name: 'Rahim Uddin', roll: uniq('r'), email: mail('stu'), sectionId, ...extra });
const csvUpload = (url: string, csv: string, c = admin.c) =>
  request(app).post(url).set('X-Requested-With', 'cms').set('Cookie', c.cookie).attach('file', Buffer.from(csv, 'utf8'), 'import.csv');
const header = 'name,roll,email,session,group,section\n';

async function twoSections() {
  const tree = await makeSessionViaApi(admin.c);
  const a = tree.groups.science.sectionId;
  const b = (await admin.c.post(`/api/academics/groups/${tree.groups.science.id}/sections`, { name: 'B', classLevel: 11 })).body.id as string;
  return { tree, a, b };
}

describe('create student/teacher', () => {
  it('[ACAD-14] plain password returned once, not stored or retrievable', async () => {
    const { a } = await twoSections();
    const res = await newStudent(a);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const { id, loginId, password } = res.body as { id: string; loginId: string; password: string };
    expect(loginId).toMatch(/^S-\d{4}-\d{4}$/);
    expect(password).toHaveLength(12);
    // stored as an argon2 hash only
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(password);
    expect(user.firstLogin && user.mustChangePassword).toBe(true);
    // not in any audit row, notification or later read
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { targetId: id } }));
    expect(audits).not.toContain(password);
    const overview = JSON.stringify((await admin.c.get(`/api/admin/students/${id}/360?tab=overview`)).body);
    expect(overview).not.toContain(password);
    expect(overview).not.toContain('argon2');
    const t = await clientFor(app, await makeTeacher(prisma));
    expect((await t.get(`/api/users/students/${id}`)).status).toBe(404);
    // the credential works on first login, then a reset issues a different one-time password
    const login = await request(app).post('/api/auth/login').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.77.0.1').send({ identifier: loginId, password });
    expect(login.body.next).toBe('complete_profile');
    const reset = await admin.c.post(`/api/users/${id}/reset-password`, {});
    expect(reset.status).toBe(200);
    expect(reset.body.password).not.toBe(password);
    expect(reset.headers['cache-control']).toBe('no-store');
    expect((await prisma.loginSession.count({ where: { userId: id, revokedAt: null } }))).toBe(0);
    // generator: 12 characters, no look-alikes
    for (let i = 0; i < 50; i++) expect(generatePassword()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{12}$/);
    const gen = await admin.c.post('/api/users/generate-password', {});
    expect(gen.body.password).toHaveLength(12);
  });

  it('login ids are sequential per session year; teachers get T-0001 style ids; deny for non-admins', async () => {
    const { a } = await twoSections();
    const s1 = (await newStudent(a)).body.loginId as string;
    const s2 = (await newStudent(a)).body.loginId as string;
    expect(Number(s2.split('-')[2]) - Number(s1.split('-')[2])).toBe(1);
    const tch = await admin.c.post('/api/users/teachers', { name: 'Karim', email: mail('tch'), subjects: ['Physics'] });
    expect(tch.status).toBe(201);
    expect(tch.body.loginId).toMatch(/^T-\d{4}$/);
    expect((await admin.c.post('/api/users/teachers', { name: 'K2', email: mail('tch'), loginId: tch.body.loginId })).status).toBe(409);
    expect((await newStudent(a, { email: 'not-an-email' })).status).toBe(400);
    expect((await newStudent(a, { password: 'short' })).status).toBe(400);
    const tc = await clientFor(app, await makeTeacher(prisma));
    expect((await tc.post('/api/users/students', { name: 'X', roll: '1', email: mail(), sectionId: a })).status).toBe(403);
    const stuUser = await prisma.user.update({ where: { id: (await prisma.user.findFirstOrThrow({ where: { loginId: s1 } })).id }, data: { firstLogin: false } });
    const sc = await clientFor(app, stuUser);
    expect((await sc.get('/api/users/teachers')).status).toBe(403);
    // teacher dropdown: subject matches first
    const list = await admin.c.get('/api/users/teachers?subject=physics');
    expect(list.body.items[0].subjects).toContain('Physics');
  });

  it('student create adds enrollments for running offerings and chat membership', async () => {
    const { a } = await twoSections();
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11', isOptional: true });
    const t = await makeTeacher(prisma);
    await admin.c.put(`/api/academics/sections/${a}/offerings`, { items: [{ courseId: course.id, teacherId: t.id }] });
    const res = await newStudent(a);
    expect(await prisma.enrollment.count({ where: { studentId: res.body.id, status: 'active' } })).toBe(1); // optional included by default
    expect(await prisma.conversationMember.count({ where: { userId: res.body.id, leftAt: null } })).toBe(2); // section + group
  });
});

describe('[ACAD-02] the 30-student limit', () => {
  it('holds on create, with a concurrent last place, and ignores inactive/passed-out/deleted', async () => {
    const { a } = await twoSections();
    await fillStudents(prisma, a, 26);
    await fillStudents(prisma, a, 2, 'inactive');
    await fillStudents(prisma, a, 2, 'passed_out');
    await fillStudents(prisma, a, 2, 'deleted');
    expect((await newStudent(a)).status).toBe(201); // 27
    expect((await newStudent(a)).status).toBe(201); // 28
    expect((await newStudent(a)).status).toBe(201); // 29
    // two requests race for place 30
    const race = await Promise.all([newStudent(a), newStudent(a)]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = race.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('SECTION_FULL');
    expect(await prisma.studentProfile.count({ where: { sectionId: a, user: { status: 'active' } } })).toBe(30);
    expect((await newStudent(a)).status).toBe(409);
    // an inactive student does not count: deactivating frees a place, reactivating into a full section is refused
    const one = (await prisma.studentProfile.findFirstOrThrow({ where: { sectionId: a, user: { status: 'active' } } })).userId;
    expect((await admin.c.post(`/api/users/${one}/deactivate`, {})).status).toBe(200);
    expect((await newStudent(a)).status).toBe(201);
    const back = await admin.c.post(`/api/users/${one}/reactivate`, {});
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('SECTION_FULL');
  });

  it('holds on CSV import', async () => {
    const { a, tree } = await twoSections();
    const sess = await prisma.session.findUniqueOrThrow({ where: { id: tree.sessionId } });
    await fillStudents(prisma, a, 29);
    const csv = `${header}A One,1,${mail('i')},${sess.name},science,A\nB Two,2,${mail('i')},${sess.name},science,A\n`;
    const dry = await csvUpload('/api/users/import/students?dryRun=true', csv);
    expect(dry.body.errors).toEqual([expect.objectContaining({ row: 3, field: 'section' })]);
    const real = await csvUpload('/api/users/import/students', csv);
    expect(real.status).toBe(400);
    expect(await prisma.studentProfile.count({ where: { sectionId: a } })).toBe(29);
  });

  it('holds on move, including concurrent moves for the last place', async () => {
    const { a, b } = await twoSections();
    const src = await fillStudents(prisma, a, 4);
    await fillStudents(prisma, b, 28);
    const full = await admin.c.post('/api/users/students/move', { studentIds: [src[0]!.id, src[1]!.id, src[2]!.id], targetSectionId: b });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SECTION_FULL');
    expect(await prisma.studentProfile.count({ where: { sectionId: b } })).toBe(28); // nothing moved
    const race = await Promise.all([
      admin.c.post('/api/users/students/move', { studentIds: [src[0]!.id, src[1]!.id], targetSectionId: b }),
      admin.c.post('/api/users/students/move', { studentIds: [src[2]!.id, src[3]!.id], targetSectionId: b }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.studentProfile.count({ where: { sectionId: b, user: { status: 'active' } } })).toBe(30);
  });
});

describe('[ACAD-03] CSV import', () => {
  it('one bad row imports nothing; the dry run lists every error', async () => {
    const { tree } = await twoSections();
    const sess = await prisma.session.findUniqueOrThrow({ where: { id: tree.sessionId } });
    const dupe = mail('dupe');
    await newStudent(tree.groups.science.sectionId, { email: dupe, roll: '900' });
    const rows = [
      `Good One,1,${mail('g')},${sess.name},science,A`,
      `Bad Email,2,not-an-email,${sess.name},science,A`,
      `Dup Email,3,${dupe},${sess.name},science,A`,
      `Unknown Section,4,${mail('u')},${sess.name},science,Z`,
      `Unknown Session,5,${mail('s')},1999–00,science,A`,
      `Dup Roll,1,${mail('d')},${sess.name},science,A`,
      `,6,${mail('n')},${sess.name},science,A`,
    ];
    const before = await prisma.user.count();
    const dry = await csvUpload('/api/users/import/students?dryRun=true', header + rows.join('\n'));
    expect(dry.status).toBe(200);
    expect(dry.body.total).toBe(7);
    const errs = dry.body.errors as { row: number; field: string }[];
    expect(errs.map((e) => `${e.row}:${e.field}`).sort()).toEqual(['3:email', '4:email', '5:section', '6:session', '7:roll', '8:name'].sort());
    expect(dry.body.valid).toBe(1);
    const real = await csvUpload('/api/users/import/students', header + rows.join('\n'));
    expect(real.status).toBe(400);
    expect(real.body.errors).toHaveLength(6);
    expect(await prisma.user.count()).toBe(before);
    // deny and bad uploads
    expect((await csvUpload('/api/users/import/students', header, await clientFor(app, await makeTeacher(prisma)))).status).toBe(403);
    expect((await request(app).post('/api/users/import/students').set('X-Requested-With', 'cms').set('Cookie', admin.c.cookie)).status).toBe(400);
    expect((await csvUpload('/api/users/import/students?dryRun=true', 'name,roll\nA,1\n')).status).toBe(400); // missing columns
  });

  it('a clean file imports all rows (Bangla, BOM), and slips download exactly once', async () => {
    const { tree } = await twoSections();
    const sess = await prisma.session.findUniqueOrThrow({ where: { id: tree.sessionId } });
    const csv = `${'﻿'}${header}রহিম উদ্দিন,1,${mail('b1')},${sess.name},science,A\n=cmd|x,2,${mail('b2')},${sess.name},science,A\n`;
    const res = await csvUpload('/api/users/import/students', csv);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.headers['cache-control']).toBe('no-store');
    const names = (await prisma.studentProfile.findMany({ where: { sectionId: tree.groups.science.sectionId } })).map((s) => s.name);
    expect(names).toContain('রহিম উদ্দিন');
    const url = `/api/users/import/slips/${res.body.slipToken}`;
    const csvOut = await admin.c.get(`${url}?format=csv`);
    expect(csvOut.status).toBe(200);
    expect(csvOut.headers['content-type']).toContain('text/csv');
    const text = csvOut.text;
    expect(text).toContain('রহিম উদ্দিন');
    expect(text).toContain("'=cmd|x"); // spreadsheet formula guard
    expect(text.split('\n').filter((l) => /S-\d{4}-\d{4}/.test(l))).toHaveLength(2);
    expect((await admin.c.get(`${url}?format=csv`)).status).toBe(404); // once
    const pdf = await admin.c.req('get', `${url}?format=pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (d: Buffer) => chunks.push(d));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await admin.c.get(`${url}?format=pdf`)).status).toBe(404);
    const other = (await adminClient(prisma, app)).c;
    expect((await other.get(`/api/users/import/slips/${res.body.slipToken}?format=pdf`)).status).toBe(404);
  });

  it('teacher import validates and creates', async () => {
    const e = mail('timp');
    const dry = await csvUpload('/api/users/import/teachers?dryRun=true', `name,email,designation,subjects\nA,${e},Lecturer,Physics;Math\nB,${e},,\n`);
    expect(dry.body.errors).toEqual([expect.objectContaining({ row: 3, field: 'email' })]);
    const ok = await csvUpload('/api/users/import/teachers', `name,email,designation,subjects\nA,${e},Lecturer,Physics;Math\n`);
    expect(ok.status).toBe(201);
    const t = await prisma.teacherProfile.findFirstOrThrow({ where: { user: { email: e } } });
    expect(t.subjects).toEqual(['Physics', 'Math']);
  });
});

describe('[ACAD-04] move and promote', () => {
  it('move ends/creates enrollments, keeps old sectionId on history; promotion 11 to 12', async () => {
    const { tree, a, b } = await twoSections();
    const t = await makeTeacher(prisma);
    const cA = await makeCourse(prisma, { groupType: 'common' });
    const cB = await makeCourse(prisma, { groupType: 'common' });
    await admin.c.put(`/api/academics/sections/${a}/offerings`, { items: [{ courseId: cA.id, teacherId: t.id }] });
    await admin.c.put(`/api/academics/sections/${b}/offerings`, { items: [{ courseId: cB.id, teacherId: t.id }] });
    const [stu] = await fillStudents(prisma, a, 1);
    const offA = await prisma.courseOffering.findFirstOrThrow({ where: { sectionId: a } });
    const offB = await prisma.courseOffering.findFirstOrThrow({ where: { sectionId: b } });
    await prisma.enrollment.create({ data: { courseOfferingId: offA.id, studentId: stu!.id } });
    const meeting = await prisma.classMeeting.create({
      data: { date: new Date('2030-01-10'), startTime: new Date('1970-01-01T09:00:00Z'), endTime: new Date('1970-01-01T09:45:00Z'), teacherId: t.id, offerings: { create: { courseOfferingId: offA.id } } },
    });
    await prisma.attendanceRecord.create({ data: { classMeetingId: meeting.id, studentId: stu!.id, sectionId: a, courseOfferingId: offA.id, status: 'present', markedBy: t.id } });

    const mv = await admin.c.post('/api/users/students/move', { studentIds: [stu!.id], targetSectionId: b });
    expect(mv.status).toBe(200);
    const enr = await prisma.enrollment.findMany({ where: { studentId: stu!.id } });
    expect(enr.filter((e) => e.courseOfferingId === offA.id).every((e) => e.status === 'ended' && e.endedAt)).toBe(true);
    expect(enr.filter((e) => e.courseOfferingId === offB.id && e.status === 'active')).toHaveLength(1);
    expect((await prisma.studentProfile.findUniqueOrThrow({ where: { userId: stu!.id } })).sectionId).toBe(b);
    expect((await prisma.attendanceRecord.findFirstOrThrow({ where: { studentId: stu!.id } })).sectionId).toBe(a); // history keeps the old section
    // chat: out of A's section chat, into B's
    const chatOf = async (sid: string) => (await prisma.conversation.findUniqueOrThrow({ where: { type_refId: { type: 'section', refId: sid } } })).id;
    const m = async (sid: string) => (await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: await chatOf(sid), userId: stu!.id } } }))?.leftAt;
    expect(await m(b)).toBeNull();
    // promotion: whole section A -> class 12 section in the same group
    const sci12 = (await admin.c.post(`/api/academics/groups/${tree.groups.science.id}/sections`, { name: 'A', classLevel: 12 })).body.id as string;
    const promo = await admin.c.post('/api/users/students/move', { wholeSectionId: b, targetSectionId: sci12 });
    expect(promo.status).toBe(200);
    const row = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: stu!.id }, include: { section: true } });
    expect(row.section.classLevel).toBe(12); // class follows the section
    expect(await prisma.studentProfile.count({ where: { sectionId: b } })).toBe(0);
    // validation: other session, same section, non-admin
    const other = await makeSessionViaApi(admin.c);
    expect((await admin.c.post('/api/users/students/move', { studentIds: [stu!.id], targetSectionId: other.groups.science.sectionId })).status).toBe(400);
    expect((await admin.c.post('/api/users/students/move', { studentIds: [stu!.id], targetSectionId: sci12 })).status).toBe(400);
    expect((await (await clientFor(app, await makeTeacher(prisma))).post('/api/users/students/move', { studentIds: [stu!.id], targetSectionId: b })).status).toBe(403);
  });

  it('a student with a running exam attempt cannot be moved', async () => {
    const { a, b } = await twoSections();
    const t = await makeTeacher(prisma);
    const course = await makeCourse(prisma, { groupType: 'common' });
    await admin.c.put(`/api/academics/sections/${a}/offerings`, { items: [{ courseId: course.id, teacherId: t.id }] });
    const [stu] = await fillStudents(prisma, a, 1);
    const off = await prisma.courseOffering.findFirstOrThrow({ where: { sectionId: a } });
    const exam = await prisma.exam.create({
      data: { courseOfferingId: off.id, createdBy: t.id, kind: 'quiz', title: 'Q', startAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 3600_000), durationMin: 30, totalMarks: 5, passMarks: 2, status: 'published' },
    });
    await prisma.examAttempt.create({ data: { examId: exam.id, studentId: stu!.id, attemptNo: 1, sectionId: a, deadlineAt: new Date(Date.now() + 600_000), questionOrder: [], status: 'in_progress' } });
    const r = await admin.c.post('/api/users/students/move', { studentIds: [stu!.id], targetSectionId: b });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ATTEMPT_IN_PROGRESS');
  });
});

describe('edit and status', () => {
  it('edit, email change un-verifies, deactivate blocks login and revokes, reactivate restores', async () => {
    const { a } = await twoSections();
    const made = await newStudent(a);
    const id = made.body.id as string;
    await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
    const newMail = mail('chg');
    const ed = await admin.c.patch(`/api/users/${id}`, { name: 'Renamed', email: newMail, roll: 'R-9', nameLocked: true });
    expect(ed.status).toBe(200);
    expect(ed.body.emailChanged).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { id }, include: { student: true } });
    expect(u.email).toBe(newMail);
    expect(u.emailVerifiedAt).toBeNull();
    expect(u.student).toMatchObject({ name: 'Renamed', roll: 'R-9', nameLocked: true });
    expect((await prisma.token.count({ where: { userId: id, purpose: 'email_verify' } }))).toBe(1);
    expect(mailbox.sent.at(-1)?.m.to).toBe(newMail);
    expect((await admin.c.patch(`/api/users/${id}`, { designation: 'x' })).status).toBe(400); // teacher-only field
    // login, deactivate, blocked
    const login = await request(app).post('/api/auth/login').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.77.1.1').send({ identifier: made.body.loginId, password: made.body.password });
    expect(login.status).toBe(200);
    expect((await admin.c.post(`/api/users/${id}/deactivate`, {})).status).toBe(200);
    expect(await prisma.loginSession.count({ where: { userId: id, revokedAt: null } })).toBe(0);
    const blocked = await request(app).post('/api/auth/login').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.77.1.2').send({ identifier: made.body.loginId, password: made.body.password });
    expect(blocked.body.error.code).toBe('ACCOUNT_INACTIVE');
    expect((await admin.c.post(`/api/users/${id}/deactivate`, {})).status).toBe(409);
    expect((await admin.c.post(`/api/users/${id}/reactivate`, {})).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe('active');
    // deny
    const tc = await clientFor(app, await makeTeacher(prisma));
    for (const [m, p] of [['patch', `/api/users/${id}`], ['post', `/api/users/${id}/deactivate`], ['post', `/api/users/${id}/reset-password`], ['delete', `/api/users/${id}`]] as const)
      expect((await tc.req(m, p, {})).status, p).toBe(403);
  });
});

describe('[ACAD-09] permanent delete = anonymise', () => {
  it('anonymises fields, deletes AI chats, keeps posts as Deleted user', async () => {
    const { a } = await twoSections();
    const made = await newStudent(a);
    const id = made.body.id as string;
    const avatar = await prisma.storageObject.create({ data: { bucket: 'public', key: uniq('av'), mime: 'image/webp', size: 10, uploadedBy: id } });
    await prisma.user.update({ where: { id }, data: { mobile: '01711111111', avatarId: avatar.id } });
    await prisma.studentProfile.update({ where: { userId: id }, data: { bio: 'hello', dob: new Date('2008-05-05'), address: 'Dhaka', guardianName: 'G', guardianContact: '017' } });
    const post = await prisma.post.create({ data: { authorId: id, text: 'My post' } });
    const conv = await prisma.aIConversation.create({ data: { studentId: id, title: 'Chat', messages: { create: { role: 'user', content: 'hi' } } } });
    await prisma.pushSubscription.create({ data: { userId: id, endpoint: uniq('ep'), p256dh: 'x', auth: 'y' } });
    await prisma.notificationPref.create({ data: { userId: id, type: 'notice_new' } });
    await prisma.token.create({ data: { userId: id, tokenHash: uniq('th'), purpose: 'password_reset', expiresAt: new Date(Date.now() + 1000) } });
    const login = await request(app).post('/api/auth/login').set('X-Requested-With', 'cms').set('X-Forwarded-For', '10.77.2.1').send({ identifier: made.body.loginId, password: made.body.password });
    expect(login.status).toBe(200);

    expect((await admin.c.req('delete', `/api/users/${id}`, { confirmLoginId: 'WRONG' })).status).toBe(400);
    expect((await admin.c.req('delete', `/api/users/${id}`, { confirmLoginId: made.body.loginId })).status).toBe(200);

    const u = await prisma.user.findUniqueOrThrow({ where: { id }, include: { student: true } });
    expect(u).toMatchObject({ loginId: null, email: null, mobile: null, passwordHash: null, avatarId: null, status: 'deleted' });
    expect(u.anonymisedAt).not.toBeNull();
    expect(u.student).toMatchObject({ name: 'Deleted user', bio: null, dob: null, address: null, guardianName: null, guardianContact: null });
    expect(await prisma.aIConversation.count({ where: { studentId: id } })).toBe(0);
    expect(await prisma.aIMessage.count({ where: { conversationId: conv.id } })).toBe(0);
    expect((await prisma.storageObject.findUniqueOrThrow({ where: { id: avatar.id } })).deletedAt).not.toBeNull();
    expect(await prisma.pushSubscription.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.notificationPref.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.token.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.loginSession.count({ where: { userId: id, revokedAt: null } })).toBe(0);
    expect(await prisma.conversationMember.count({ where: { userId: id, leftAt: null } })).toBe(0);
    const kept = await prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: { author: { include: { student: true } } } });
    expect(kept.text).toBe('My post');
    expect(kept.author.student?.name).toBe('Deleted user');
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { targetId: id } }));
    expect(audits).not.toContain('Rahim');
    expect((await admin.c.req('delete', `/api/users/${id}`, { confirmLoginId: made.body.loginId })).status).toBe(404); // already gone
  });

  it('a teacher with running courses must be reassigned first; mentor slot is freed', async () => {
    const { a } = await twoSections();
    const tch = await admin.c.post('/api/users/teachers', { name: 'T Del', email: mail('td'), subjects: [] });
    const course = await makeCourse(prisma, { groupType: 'common' });
    await admin.c.put(`/api/academics/sections/${a}/offerings`, { items: [{ courseId: course.id, teacherId: tch.body.id }] });
    expect((await admin.c.req('delete', `/api/users/${tch.body.id}`, { confirmLoginId: tch.body.loginId })).status).toBe(409);
    await admin.c.put(`/api/academics/sections/${a}/offerings`, { items: [] });
    await admin.c.patch(`/api/academics/sections/${a}`, { mentorTeacherId: tch.body.id });
    expect((await admin.c.req('delete', `/api/users/${tch.body.id}`, { confirmLoginId: tch.body.loginId })).status).toBe(200);
    expect((await prisma.section.findUniqueOrThrow({ where: { id: a } })).mentorTeacherId).toBeNull();
  });
});

describe('[ACAD-10] pass-out', () => {
  it('session close passes out active students, blocks login, leaves chats; nothing is automatic', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const sec = tree.groups.science.sectionId;
    const s1 = await newStudent(sec);
    const s2 = await newStudent(sec);
    const [inactive] = await fillStudents(prisma, sec, 1, 'inactive');
    const otherTree = await makeSessionViaApi(admin.c);
    const outsider = await newStudent(otherTree.groups.science.sectionId);
    await prisma.session.update({ where: { id: tree.sessionId }, data: { createdAt: new Date('2000-01-01') } }); // old, but never closed by date
    const loginOf = (s: { body: { loginId: string; password: string } }, ip: string) =>
      request(app).post('/api/auth/login').set('X-Requested-With', 'cms').set('X-Forwarded-For', ip).send({ identifier: s.body.loginId, password: s.body.password });
    const first = await loginOf(s1, '10.88.0.1');
    expect(first.status).toBe(200);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: tree.sessionId } })).status).toBe('active'); // nothing automatic
    expect(await prisma.user.count({ where: { id: { in: [s1.body.id, s2.body.id] }, status: 'active' } })).toBe(2);

    expect((await admin.c.post(`/api/academics/sessions/${tree.sessionId}/close`, {})).status).toBe(400); // needs confirm
    const closed = await admin.c.post(`/api/academics/sessions/${tree.sessionId}/close`, { confirm: true });
    expect(closed.status).toBe(200);
    expect(closed.body.passedOut).toBe(2);
    const status = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(s1.body.id)).toBe('passed_out');
    expect(await status(s2.body.id)).toBe('passed_out');
    expect(await status(inactive!.id)).toBe('inactive');
    expect(await status(outsider.body.id)).toBe('active');
    expect((await prisma.studentProfile.findUniqueOrThrow({ where: { userId: s1.body.id } })).passedOutAt).not.toBeNull();
    const blocked = await loginOf(s1, '10.88.0.2');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_PASSED_OUT');
    expect(await prisma.loginSession.count({ where: { userId: s1.body.id, revokedAt: null } })).toBe(0);
    expect(await prisma.conversationMember.count({ where: { userId: { in: [s1.body.id, s2.body.id] }, leftAt: null } })).toBe(0);
    expect(await prisma.conversationMember.count({ where: { userId: outsider.body.id, leftAt: null } })).toBe(2);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: tree.sessionId } })).closedAt).not.toBeNull();
    // archived data stays readable by the Admin; the Admin can anonymise a passed-out student
    expect((await admin.c.get(`/api/admin/students/${s1.body.id}/360?tab=overview`)).status).toBe(200);
    expect((await admin.c.req('delete', `/api/users/${s1.body.id}`, { confirmLoginId: s1.body.loginId })).status).toBe(200);
  });

  it('individual pass-out affects only the chosen active students', async () => {
    const { a } = await twoSections();
    const s1 = await newStudent(a);
    const s2 = await newStudent(a);
    const r = await admin.c.post('/api/users/students/pass-out', { studentIds: [s1.body.id] });
    expect(r.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s1.body.id } })).status).toBe('passed_out');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s2.body.id } })).status).toBe('active');
    expect((await admin.c.post('/api/users/students/pass-out', { studentIds: [s1.body.id] })).status).toBe(400); // already out
    expect((await (await clientFor(app, await makeTeacher(prisma))).post('/api/users/students/pass-out', { studentIds: [s2.body.id] })).status).toBe(403);
  });
});

describe('[ACAD-12] privacy and Student 360', () => {
  it('teacher/mentor payloads have no private fields; 360 is 404 for non-admins', async () => {
    const { a } = await twoSections();
    const course = await makeCourse(prisma, { groupType: 'common' });
    const teacher = await makeTeacher(prisma);
    const mentor = await makeTeacher(prisma);
    const stranger = await makeTeacher(prisma);
    await admin.c.put(`/api/academics/sections/${a}/offerings`, { items: [{ courseId: course.id, teacherId: teacher.id }] });
    await admin.c.patch(`/api/academics/sections/${a}`, { mentorTeacherId: mentor.id });
    const made = await newStudent(a, { name: 'Private Person' });
    const id = made.body.id as string;
    await prisma.user.update({ where: { id }, data: { mobile: '01799999999' } });
    await prisma.studentProfile.update({ where: { userId: id }, data: { address: 'Secret Lane 5', dob: new Date('2007-07-07'), guardianName: 'Guardian Gee', guardianContact: '01888888888', bio: 'private bio' } });

    for (const who of [teacher, mentor]) {
      const res = await (await clientFor(app, who)).get(`/api/users/students/${id}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['avatarId', 'courses', 'id', 'loginId', 'name', 'roll', 'section', 'status']);
      const text = JSON.stringify(res.body);
      for (const secret of ['01799999999', 'Secret Lane', '2007-07-07', 'Guardian Gee', '01888888888', 'private bio', '@x.test', 'mobile', 'dob', 'address', 'guardian'])
        expect(text, secret).not.toContain(secret);
      expect(res.body.courses).toHaveLength(1);
    }
    // the section page and the course lists for teachers carry no private fields either
    const secPage = JSON.stringify((await (await clientFor(app, teacher)).get(`/api/academics/sections/${a}`)).body);
    for (const secret of ['01799999999', 'Secret Lane', '2007-07-07', 'Guardian Gee']) expect(secPage).not.toContain(secret);
    expect(secPage).not.toContain('@x.test');
    // an unrelated teacher and a student are denied
    expect((await (await clientFor(app, stranger)).get(`/api/users/students/${id}`)).status).toBe(404);
    const studentUser = await prisma.user.findUniqueOrThrow({ where: { id } });
    await prisma.user.update({ where: { id }, data: { firstLogin: false } });
    expect((await (await clientFor(app, studentUser)).get(`/api/users/students/${id}`)).status).toBe(403);

    // 360: Admin sees everything; everybody else gets 404
    const full = await admin.c.get(`/api/admin/students/${id}/360?tab=overview`);
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ mobile: '01799999999', address: 'Secret Lane 5', guardianName: 'Guardian Gee' });
    expect(JSON.stringify(full.body)).not.toMatch(/ai[_ ]?(chat|message|conversation)/i);
    const acad = await admin.c.get(`/api/admin/students/${id}/360?tab=academic`);
    expect(acad.body.enrollments).toHaveLength(1);
    expect((await admin.c.get(`/api/admin/students/${id}/360?tab=bogus`)).status).toBe(400);
    for (const c of [await clientFor(app, teacher), await clientFor(app, mentor), await clientFor(app, studentUser)]) {
      expect((await c.get(`/api/admin/students/${id}/360?tab=overview`)).status).toBe(404);
      expect((await c.get('/api/admin/students/search?q=Private')).status).toBe(404);
    }
    expect((await client(app).get(`/api/admin/students/${id}/360`)).status).toBe(401);
  });

  it('search by login id, name, roll and mobile; max 20', async () => {
    const { a } = await twoSections();
    const made = await newStudent(a, { name: 'Zubayer Search', roll: 'ZS-77' });
    await prisma.user.update({ where: { id: made.body.id }, data: { mobile: '01711223344' } });
    for (const q of [made.body.loginId, made.body.loginId.slice(0, 7), 'zubayer sea', 'ZS-77', '+8801711223344', '01711223344']) {
      const r = await admin.c.get(`/api/admin/students/search?q=${encodeURIComponent(q)}`);
      expect(r.body.items.map((i: { id: string }) => i.id), q).toContain(made.body.id);
    }
    await fillStudents(prisma, (await twoSections()).a, 25);
    const many = await admin.c.get('/api/admin/students/search?q=Filler');
    expect(many.body.items.length).toBeLessThanOrEqual(20);
    expect((await admin.c.get('/api/admin/students/search?q=%25')).body.items).toHaveLength(0); // wildcard is escaped
    expect(JSON.stringify(many.body)).not.toContain('mobile');
  });
});

describe('[ACAD-13] audit trail', () => {
  it('every admin write creates an AuditLog row with no personal data', async () => {
    const { tree, a, b } = await twoSections();
    const marker = uniq('Zq'); // goes into names and emails, must never reach the audit log
    const course = await makeCourse(prisma, { groupType: 'common' });
    const teacher = await admin.c.post('/api/users/teachers', { name: `Tea ${marker}`, email: `${marker}@x.test`, subjects: [] });
    const stu = await newStudent(a, { name: `Stu ${marker}`, email: `s${marker}@x.test` });
    const writes: [string, () => Promise<{ status: number }>][] = [
      ['section.create', () => admin.c.post(`/api/academics/groups/${tree.groups.arts.id}/sections`, { name: 'Q', classLevel: 11 })],
      ['section.mentor', () => admin.c.patch(`/api/academics/sections/${a}`, { mentorTeacherId: teacher.body.id })],
      ['section.offerings', () => admin.c.put(`/api/academics/sections/${a}/offerings`, { items: [{ courseId: course.id, teacherId: teacher.body.id }] })],
      ['course.create', () => admin.c.post('/api/academics/courses', { code: uniq('AC'), name: `Course ${marker}`, groupType: 'common', classLevel: 'both' })],
      ['user.edit', () => admin.c.patch(`/api/users/${stu.body.id}`, { name: `New ${marker}`, email: `n${marker}@x.test` })],
      ['user.reset_password', () => admin.c.post(`/api/users/${stu.body.id}/reset-password`, {})],
      ['user.deactivate', () => admin.c.post(`/api/users/${stu.body.id}/deactivate`, {})],
      ['user.reactivate', () => admin.c.post(`/api/users/${stu.body.id}/reactivate`, {})],
      ['student.move', () => admin.c.post('/api/users/students/move', { studentIds: [stu.body.id], targetSectionId: b })],
      ['student.pass_out', () => admin.c.post('/api/users/students/pass-out', { studentIds: [stu.body.id] })],
      ['user.anonymise', () => admin.c.req('delete', `/api/users/${stu.body.id}`, { confirmLoginId: stu.body.loginId })],
      ['session.close', () => admin.c.post(`/api/academics/sessions/${tree.sessionId}/close`, { confirm: true })],
    ];
    for (const [action, run] of writes) {
      const before = await prisma.auditLog.count({ where: { action, actorId: admin.admin.id } });
      const r = await run();
      expect(r.status, action).toBe(200 + (action.endsWith('.create') ? 1 : 0));
      expect(await prisma.auditLog.count({ where: { action, actorId: admin.admin.id } }), action).toBe(before + 1);
    }
    const rows = await prisma.auditLog.findMany({ where: { actorId: admin.admin.id } });
    const text = JSON.stringify(rows.map((r) => r.changes));
    expect(text).not.toContain(marker);
    expect(text).not.toContain('Rahim');
    for (const r of rows) {
      const walk = (v: unknown): void => {
        if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { expect(AUDIT_DENY_KEYS as readonly string[]).not.toContain(k.toLowerCase()); walk(x); }
      };
      walk(r.changes);
    }
  });

  it('audit() refuses personal-data keys, and no audit( call in the source uses one', async () => {
    for (const k of ['email', 'mobile', 'name', 'password', 'dob', 'address', 'loginId', 'guardianName'])
      await expect(audit(admin.admin.id, 'x', 'user', 'y', { [k]: 'v' })).rejects.toThrow(/personal-data key/);
    await expect(audit(admin.admin.id, 'x', 'user', 'y', { nested: { Email: 'v' } })).rejects.toThrow();
    await expect(audit(admin.admin.id, 'x.ok', 'user', 'y', { count: 1 })).resolves.toBeUndefined();
    // static scan of every audit( call
    const root = path.resolve(__dirname, '../..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.includes('.test.') && !p.endsWith('audit.ts')) files.push(p);
      }
    };
    walk(root);
    const deny = new RegExp(`[{,]\\s*(${AUDIT_DENY_KEYS.join('|')})\\s*:`, 'i');
    let calls = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\baudit\(([^;]*?)\);/gs)) {
        calls++;
        expect(deny.test(m[1]!), `${path.basename(f)}: ${m[0].slice(0, 80)}`).toBe(false);
      }
    }
    expect(calls).toBeGreaterThan(20);
  });
});
