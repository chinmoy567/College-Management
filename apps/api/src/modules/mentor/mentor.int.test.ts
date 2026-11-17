import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { chatMembership } from '../../lib/chatMembership';
import { adminClient, classroom, clientFor, makeApp, makeTeacher, pastMeeting } from '../../../../../test/m5kit';

const app = makeApp();
let admin: Awaited<ReturnType<typeof adminClient>>;
beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterAll(() => prisma.$disconnect());

type Room = Awaited<ReturnType<typeof classroom>>;
/** A classroom whose section has a mentor (assigned through the Admin API, so chat membership is synced like in the app). */
async function mentored(students = 3): Promise<Room & { mentor: Awaited<ReturnType<typeof makeTeacher>> }> {
  const c = await classroom(prisma, admin.c, students);
  const mentor = await makeTeacher(prisma);
  const r = await admin.c.patch(`/api/academics/sections/${c.sectionId}`, { mentorTeacherId: mentor.id });
  expect(r.status).toBe(200);
  await chatMembership.syncMany([mentor.id, ...c.students.map((s) => s.id)]);
  return { ...c, mentor };
}

describe('mentor workspace', () => {
  it('[ACAD-17] only the mentor of a section may use it; other teachers, students and the Admin get 403; another section\'s student is 404', async () => {
    const a = await mentored();
    const b = await mentored();
    const mentor = await clientFor(app, a.mentor);
    for (const path of ['/api/mentor/section', '/api/mentor/section/students']) {
      expect((await mentor.get(path)).status).toBe(200);
      expect((await (await clientFor(app, a.teacher)).get(path)).status).toBe(403); // teaches in the section, mentors nothing
      expect((await (await clientFor(app, a.students[0]!)).get(path)).status).toBe(403);
      expect((await admin.c.get(path)).status).toBe(403);
    }
    expect((await mentor.get(`/api/mentor/section/students/${a.students[0]!.id}`)).status).toBe(200);
    expect((await mentor.get(`/api/mentor/section/students/${b.students[0]!.id}`)).status).toBe(404);
    const list = (await mentor.get('/api/mentor/section/students')).body.items as { id: string }[];
    expect(list.map((s) => s.id).sort()).toEqual(a.students.map((s) => s.id).sort());
  });

  it('[ACAD-18] the list carries attendance %, exam average, last active and flags, and the summary counts match', async () => {
    const c = await mentored(3);
    const [absent, ok, old] = c.students;
    // attendance: the first student is absent for the only held class, the others present
    const meeting = await pastMeeting(prisma, c.offering.id, c.teacher.id);
    const teacher = await clientFor(app, c.teacher);
    const sheet = await teacher.post(`/api/attendance/meetings/${meeting.id}/sheet`, {
      records: c.students.map((s) => ({ studentId: s.id, status: s.id === absent!.id ? 'absent' : 'present' })),
      clientDraftId: `draft-mentor-${Date.now()}`,
    });
    expect(sheet.status).toBe(200);
    // one published exam (pass 4 of 10): the first student fails, the others pass
    const exam = await prisma.exam.create({
      data: {
        courseOfferingId: c.offering.id, createdBy: c.teacher.id, kind: 'exam', title: 'Mentor exam', startAt: new Date(Date.now() - 7200_000), endAt: new Date(Date.now() - 3600_000),
        durationMin: 30, totalMarks: 10, passMarks: 4, status: 'published', resultsPublishedAt: new Date(), revealedAt: new Date(),
      },
    });
    for (const [s, score] of [[absent, 2], [ok, 9], [old, 8]] as const)
      await prisma.examAttempt.create({ data: { examId: exam.id, studentId: s!.id, attemptNo: 1, sectionId: c.sectionId, deadlineAt: new Date(), questionOrder: [], status: 'submitted', score, submittedAt: new Date() } });
    // activity: `ok` logged in now, `old` 8 days ago, `absent` never
    await prisma.user.update({ where: { id: ok!.id }, data: { lastLoginAt: new Date() } });
    await prisma.user.update({ where: { id: old!.id }, data: { lastLoginAt: new Date(Date.now() - 8 * 86_400_000) } });

    const mentor = await clientFor(app, c.mentor);
    const items = (await mentor.get('/api/mentor/section/students')).body.items as { id: string; attendancePct: number | null; examAvgPct: number | null; lastActiveAt: string | null; flags: string[] }[];
    const by = (id: string) => items.find((i) => i.id === id)!;
    expect(by(absent!.id).attendancePct).toBe(0);
    expect(by(absent!.id).examAvgPct).toBe(20);
    expect(by(absent!.id).flags.sort()).toEqual(['below_pass', 'inactive', 'low_attendance']);
    expect(by(ok!.id).attendancePct).toBe(100);
    expect(by(ok!.id).examAvgPct).toBe(90);
    expect(by(ok!.id).flags).toEqual([]);
    expect(by(ok!.id).lastActiveAt).not.toBeNull();
    expect(by(old!.id).flags).toEqual(['inactive']);

    const o = (await mentor.get('/api/mentor/section')).body;
    expect(o.summary).toMatchObject({ students: 3, lowAttendance: 1, belowPass: 1, inactive: 2 });
    expect(o.summary.attendancePct).toBeCloseTo(66.67, 1);
    expect(o.thresholds.inactiveDays).toBe(7);

    const d = (await mentor.get(`/api/mentor/section/students/${absent!.id}`)).body;
    expect(d.attendance[0]).toMatchObject({ course: c.course.code, pct: 0, present: 0, held: 1 });
    expect(d.exams[0]).toMatchObject({ title: 'Mentor exam', score: 2, totalMarks: 10, passMarks: 4, passed: false });
  });

  it('[ACAD-19] the payload never contains mobile, address, DOB or guardian details', async () => {
    const c = await mentored(2);
    await prisma.user.update({ where: { id: c.students[0]!.id }, data: { mobile: '01711111111' } });
    await prisma.studentProfile.update({ where: { userId: c.students[0]!.id }, data: { address: 'Secret Road 1', dob: new Date('2008-01-01'), guardianName: 'Guardian X', guardianContact: '01899999999' } });
    const mentor = await clientFor(app, c.mentor);
    for (const path of ['/api/mentor/section', '/api/mentor/section/students', `/api/mentor/section/students/${c.students[0]!.id}`]) {
      const text = JSON.stringify((await mentor.get(path)).body);
      for (const secret of ['01711111111', 'Secret Road', '2008-01-01', 'Guardian X', '01899999999']) expect(text).not.toContain(secret);
      expect(text).not.toMatch(/"(mobile|address|dob|guardian\w*|email)"/);
    }
  });

  it('[ACAD-20] the summary returns the section group chat; its members are the mentor and the section\'s students, nobody from another section', async () => {
    const a = await mentored(3);
    const b = await mentored(2);
    const mentor = await clientFor(app, a.mentor);
    const id = (await mentor.get('/api/mentor/section')).body.chatConversationId as string;
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conv).toMatchObject({ type: 'section', refId: a.sectionId });
    const members = (await prisma.conversationMember.findMany({ where: { conversationId: id, leftAt: null }, select: { userId: true } })).map((m) => m.userId);
    expect(members).toEqual(expect.arrayContaining([a.mentor.id, ...a.students.map((s) => s.id)]));
    for (const s of b.students) expect(members).not.toContain(s.id);
    expect(members).not.toContain(b.mentor.id);
    expect((await mentor.get(`/api/chat/conversations/${id}/messages`)).status).toBe(200);
  });
});
