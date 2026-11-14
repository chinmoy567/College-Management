import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../db';
import { captureMail } from '../../../../../test/factories';
import { adminClient, fillStudents, makeApp, makeCourse, makeSessionViaApi, makeTeacher, uniq } from '../../../../../test/m3kit';
import { defer, transaction } from '../../lib/afterCommit';
import { notify, setNotifyEmitter } from '../../lib/notify';
import { stashSlips, takeSlips } from './slips';

const app = makeApp();
captureMail();
let admin: Awaited<ReturnType<typeof adminClient>>;
beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterAll(() => prisma.$disconnect());

const mail = () => `${uniq('rv').toLowerCase()}@x.test`;

describe('review fixes', () => {
  it('after-commit queue: emits run after commit and are dropped on rollback', async () => {
    const u = await makeTeacher(prisma);
    const seen: string[] = [];
    setNotifyEmitter((id) => void seen.push(id));
    await expect(
      transaction(async (tx) => {
        await notify([u.id], 'x', null, 'rolled back', tx);
        defer(() => seen.push('later'));
        expect(seen).toEqual([]); // nothing before commit
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(seen).toEqual([]);
    await transaction(async (tx) => {
      await notify([u.id], 'x', null, 'kept', tx);
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual([u.id]);
    setNotifyEmitter(() => {});
  });

  it('slips: wrong actor does not consume a format; each format once', async () => {
    const { token } = stashSlips('a1', [{ role: 'student', name: 'N', loginId: 'S-1', password: 'pw' }]);
    expect(await takeSlips('other', token, 'csv')).toBeNull();
    expect(await takeSlips('a1', token, 'csv')).not.toBeNull();
    expect(await takeSlips('a1', token, 'csv')).toBeNull();
    expect(await takeSlips('a1', token, 'pdf')).not.toBeNull();
  });

  it('closing a session racing student create leaves no active student in the closed session', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const sec = tree.groups.science.sectionId;
    await fillStudents(prisma, sec, 3);
    const results = await Promise.all([
      admin.c.post(`/api/academics/sessions/${tree.sessionId}/close`, { confirm: true }),
      ...[1, 2, 3].map((i) => admin.c.post('/api/users/students', { name: 'Racer', roll: `race${i}${uniq('')}`, email: mail(), sectionId: sec })),
    ]);
    expect(results[0]!.status).toBe(200);
    for (const r of results.slice(1)) expect([201, 409]).toContain(r.status);
    expect(await prisma.studentProfile.count({ where: { section: { group: { sessionId: tree.sessionId } }, user: { status: 'active' } } })).toBe(0);
  });

  it('course shape cannot change while offerings exist', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    const t = await makeTeacher(prisma);
    expect((await admin.c.patch(`/api/academics/courses/${course.id}`, { isOptional: true })).status).toBe(200); // unused: free to change
    await admin.c.put(`/api/academics/sections/${tree.groups.science.sectionId}/offerings`, { items: [{ courseId: course.id, teacherId: t.id }] });
    for (const body of [{ groupType: 'arts' }, { classLevel: 'c12' }, { isOptional: false }]) {
      const r = await admin.c.patch(`/api/academics/courses/${course.id}`, body);
      expect(r.status, JSON.stringify(body)).toBe(409);
    }
    expect((await admin.c.patch(`/api/academics/courses/${course.id}`, { name: 'Renamed', isOptional: true })).status).toBe(200);
  });

  it('CSV import enforces the same length caps as the API', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const sess = await prisma.session.findUniqueOrThrow({ where: { id: tree.sessionId } });
    const csv = `name,roll,email,session,group,section\n${'N'.repeat(121)},${'9'.repeat(21)},${'e'.repeat(200)}@x.test,${sess.name},science,A\n`;
    const r = await request(app).post('/api/users/import/students?dryRun=true').set('X-Requested-With', 'cms').set('Cookie', admin.c.cookie).attach('file', Buffer.from(csv), 'a.csv');
    expect(r.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['email', 'name', 'roll']);
    const t = await request(app).post('/api/users/import/teachers?dryRun=true').set('X-Requested-With', 'cms').set('Cookie', admin.c.cookie)
      .attach('file', Buffer.from(`name,email,designation,subjects\n${'T'.repeat(121)},${mail()},${'D'.repeat(121)},${'s'.repeat(61)}\n`), 't.csv');
    expect(t.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['designation', 'name', 'subjects']);
  });

  it('anonymise is blocked while the student has a running attempt', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const sec = tree.groups.science.sectionId;
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    const t = await makeTeacher(prisma);
    await admin.c.put(`/api/academics/sections/${sec}/offerings`, { items: [{ courseId: course.id, teacherId: t.id }] });
    const made = await admin.c.post('/api/users/students', { name: 'In Exam', roll: '1', email: mail(), sectionId: sec });
    const off = await prisma.courseOffering.findFirstOrThrow({ where: { sectionId: sec } });
    const exam = await prisma.exam.create({
      data: { courseOfferingId: off.id, createdBy: t.id, kind: 'quiz', title: 'Q', startAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 3600_000), durationMin: 30, totalMarks: 5, passMarks: 2, status: 'published' },
    });
    await prisma.examAttempt.create({ data: { examId: exam.id, studentId: made.body.id, attemptNo: 1, sectionId: sec, deadlineAt: new Date(Date.now() + 600_000), questionOrder: [], status: 'in_progress' } });
    const r = await admin.c.req('delete', `/api/users/${made.body.id}`, { confirmLoginId: made.body.loginId });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ATTEMPT_IN_PROGRESS');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: made.body.id } })).status).toBe('active');
  });
});
