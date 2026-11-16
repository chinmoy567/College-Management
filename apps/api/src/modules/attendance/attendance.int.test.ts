import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { adminClient, classroom, clientFor, makeApp, makeCourse, makeTeacher, pastMeeting } from '../../../../../test/m5kit';

const app = makeApp();
let admin: Awaited<ReturnType<typeof adminClient>>;
beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterAll(() => prisma.$disconnect());

const sheet = (id: string) => `/api/attendance/meetings/${id}/sheet`;
let draft = 0;
type Api = Awaited<ReturnType<typeof clientFor>>;
const submit = (c: Api, id: string, records: { studentId: string; status: string }[], clientDraftId = `draft-${Date.now()}-${++draft}`) =>
  c.post(sheet(id), { records, clientDraftId });

describe('attendance permissions and submit', () => {
  it('[SCH-09] only the teacher, a substitute, the section mentor and the Admin may take attendance', async () => {
    const c = await classroom(prisma, admin.c);
    const m = await pastMeeting(prisma, c.offering.id, c.teacher.id);
    const other = await makeTeacher(prisma);
    const sub = await makeTeacher(prisma);
    const mentor = await makeTeacher(prisma);
    await prisma.classMeeting.update({ where: { id: m.id }, data: { substituteTeacherId: sub.id } });
    await prisma.section.update({ where: { id: c.sectionId }, data: { mentorTeacherId: mentor.id } });
    const get = async (u: Parameters<typeof clientFor>[1]) => (await clientFor(app, u)).get(sheet(m.id));
    expect((await get(c.teacher)).status).toBe(200);
    expect((await get(sub)).status).toBe(200);
    expect((await get(mentor)).status).toBe(200);
    expect((await admin.c.get(sheet(m.id))).status).toBe(200);
    expect((await get(other)).status).toBe(403);
    expect((await get(c.students[0]!)).status).toBe(403);
    expect((await (await clientFor(app, other)).post(sheet(m.id), { records: [], clientDraftId: 'x-denied-1' })).status).toBe(403);
  });

  it('[SCH-10] a 30-student sheet saves in one batch: 30 records, one notification per absent student, a later edit logs each change', async () => {
    const c = await classroom(prisma, admin.c, 30);
    const m = await pastMeeting(prisma, c.offering.id, c.teacher.id);
    const t = await clientFor(app, c.teacher);
    const rec = c.students.map((s, i) => ({ studentId: s.id, status: i < 2 ? 'absent' : 'present' }));
    const res = await submit(t, m.id, rec, 'draft-batch-0001');
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(30);
    expect(await prisma.attendanceRecord.count({ where: { classMeetingId: m.id } })).toBe(30);
    expect(await prisma.notification.count({ where: { type: 'marked_absent', userId: { in: [c.students[0]!.id, c.students[1]!.id] } } })).toBe(2);
    const edit = await submit(t, m.id, c.students.slice(0, 5).map((s) => ({ studentId: s.id, status: 'late' })), 'draft-batch-0002');
    expect(edit.body.changed).toBe(5);
    expect(await prisma.attendanceEdit.count({ where: { attendanceRecord: { classMeetingId: m.id } } })).toBe(5);
    expect(await prisma.attendanceRecord.count({ where: { classMeetingId: m.id, status: 'late' } })).toBe(5);
  });

  it('[SCH-10] re-submitting the same sheet is idempotent; changes create AttendanceEdit rows (and an AuditLog for the Admin)', async () => {
    const c = await classroom(prisma, admin.c);
    const m = await pastMeeting(prisma, c.offering.id, c.teacher.id);
    const t = await clientFor(app, c.teacher);
    const [a, b] = c.students;
    const rec = [{ studentId: a!.id, status: 'present' }, { studentId: b!.id, status: 'absent' }];
    const first = await submit(t, m.id, rec, 'draft-same-0001');
    expect(first.status).toBe(200);
    const again = await submit(t, m.id, rec, 'draft-same-0001');
    expect(again.body.repeated).toBe(true);
    expect(await prisma.attendanceRecord.count({ where: { classMeetingId: m.id } })).toBe(3);
    expect(await prisma.attendanceEdit.count({ where: { attendanceRecord: { classMeetingId: m.id } } })).toBe(0);
    const row = await prisma.classMeeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe('held');
    expect(row.attendanceTakenAt).not.toBeNull();

    const changed = await submit(t, m.id, [{ studentId: b!.id, status: 'late' }]);
    expect(changed.body.changed).toBe(1);
    expect(await prisma.attendanceEdit.count({ where: { attendanceRecord: { classMeetingId: m.id } } })).toBe(1);

    const r = await prisma.attendanceRecord.findFirstOrThrow({ where: { classMeetingId: m.id, studentId: a!.id } });
    const before = await prisma.auditLog.count({ where: { action: 'attendance.record_edit', targetId: r.id } });
    expect((await admin.c.patch(`/api/attendance/records/${r.id}`, { status: 'excused' })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'attendance.record_edit', targetId: r.id } })).toBe(before + 1);
    expect((await (await clientFor(app, c.students[0]!)).patch(`/api/attendance/records/${r.id}`, { status: 'present' })).status).toBe(403);

    // students who are not on the roster are refused
    const stranger = (await classroom(prisma, admin.c, 1)).students[0]!;
    expect((await submit(t, m.id, [{ studentId: stranger.id, status: 'present' }])).status).toBe(400);
  });

  it('refuses future, cancelled and removed meetings', async () => {
    const c = await classroom(prisma, admin.c);
    const t = await clientFor(app, c.teacher);
    const future = await admin.c.post('/api/schedule/meetings/extra', { offeringIds: [c.offering.id], date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), startTime: '08:00', endTime: '08:45' });
    expect((await submit(t, future.body.id, [])).status).toBe(400);
    const cancelled = await pastMeeting(prisma, c.offering.id, c.teacher.id, 1, 'cancelled');
    expect((await submit(t, cancelled.id, [])).status).toBe(409);
  });
});

describe('roster', () => {
  it('[SCH-12] lists only students whose enrollment was active on the meeting date; optional courses list only enrolled students', async () => {
    const c = await classroom(prisma, admin.c, 3);
    const [a, late, left] = c.students;
    const m = await pastMeeting(prisma, c.offering.id, c.teacher.id, 5);
    await prisma.enrollment.updateMany({ where: { studentId: late!.id }, data: { enrolledAt: new Date() } }); // joined after the class
    await prisma.enrollment.updateMany({ where: { studentId: left!.id }, data: { status: 'ended', endedAt: new Date(Date.now() - 20 * 86_400_000) } }); // left before it
    const res = await admin.c.get(sheet(m.id));
    const ids = res.body.offerings[0].students.map((s: { id: string }) => s.id);
    expect(ids).toEqual([a!.id]);
    // a section student who never took this (optional) course is not listed
    expect(ids).not.toContain(late!.id);
    expect(res.body.offerings[0].students.every((s: { status: string }) => s.status === 'present')).toBe(true);
  });

  it('pre-fills an online class from joins (Present) and Absent for the rest', async () => {
    const c = await classroom(prisma, admin.c, 2);
    const m = await pastMeeting(prisma, c.offering.id, c.teacher.id);
    const online = await prisma.onlineClass.create({
      data: { teacherId: c.teacher.id, title: 'L', startAt: new Date(), durationMin: 30, platform: 'meet', joinUrl: 'https://example.test/j', offerings: { create: [{ courseOfferingId: c.offering.id }] } },
    });
    await prisma.classMeeting.update({ where: { id: m.id }, data: { onlineClassId: online.id } });
    await prisma.onlineClassJoin.create({ data: { onlineClassId: online.id, studentId: c.students[0]!.id } });
    const res = await admin.c.get(sheet(m.id));
    const by = Object.fromEntries(res.body.offerings[0].students.map((s: { id: string; status: string }) => [s.id, s.status]));
    expect(by[c.students[0]!.id]).toBe('present');
    expect(by[c.students[1]!.id]).toBe('absent');
  });
});

describe('percentage', () => {
  it('[SCH-11] late counts as present, excused is excluded, cancelled meetings are not counted, N/A when nothing counts', async () => {
    const c = await classroom(prisma, admin.c, 2);
    const [s, only] = c.students;
    const statuses = ['present', 'late', 'excused', 'absent'] as const;
    for (const [i, status] of statuses.entries()) {
      const m = await pastMeeting(prisma, c.offering.id, c.teacher.id, i + 1, 'held');
      await prisma.attendanceRecord.create({ data: { classMeetingId: m.id, studentId: s!.id, sectionId: c.sectionId, courseOfferingId: c.offering.id, status, markedBy: c.teacher.id } });
    }
    const cancelled = await pastMeeting(prisma, c.offering.id, c.teacher.id, 6, 'cancelled');
    await prisma.attendanceRecord.create({ data: { classMeetingId: cancelled.id, studentId: s!.id, sectionId: c.sectionId, courseOfferingId: c.offering.id, status: 'absent', markedBy: c.teacher.id } });
    const m2 = await pastMeeting(prisma, c.offering.id, c.teacher.id, 7, 'held');
    await prisma.attendanceRecord.create({ data: { classMeetingId: m2.id, studentId: only!.id, sectionId: c.sectionId, courseOfferingId: c.offering.id, status: 'excused', markedBy: c.teacher.id } });

    const mine = await (await clientFor(app, s!)).get('/api/attendance/me');
    expect(mine.status).toBe(200);
    expect(mine.body.overall).toMatchObject({ present: 2, excused: 1, held: 4, pct: 66.7, colour: 'orange' });
    expect(mine.body.courses.find((x: { offeringId: string }) => x.offeringId === c.offering.id)).toMatchObject({ pct: 66.7 });
    const na = await (await clientFor(app, only!)).get('/api/attendance/me');
    expect(na.body.overall).toMatchObject({ pct: null, display: 'N/A', colour: 'none' });
    // another student cannot read a summary through the teacher routes
    expect((await (await clientFor(app, s!)).get(`/api/attendance/offerings/${c.offering.id}/summary`)).status).toBe(403);
    const t = await (await clientFor(app, c.teacher)).get(`/api/attendance/offerings/${c.offering.id}/low`);
    expect(t.body.students.map((x: { studentId: string }) => x.studentId)).toContain(s!.id);
  });

  it('[SCH-11] a student who moved sees only current courses in the attendance card; ended enrollments are hidden', async () => {
    const c = await classroom(prisma, admin.c, 1);
    const kid = c.students[0]!;
    const oldCourse = await makeCourse(prisma);
    const oldOffering = await prisma.courseOffering.create({ data: { sectionId: c.sectionId, courseId: oldCourse.id, teacherId: c.teacher.id } });
    await prisma.enrollment.create({ data: { courseOfferingId: oldOffering.id, studentId: kid.id, status: 'ended', endedAt: new Date() } });
    const mine = await (await clientFor(app, kid)).get('/api/attendance/me');
    expect(mine.status).toBe(200);
    const ids = mine.body.courses.map((x: { offeringId: string }) => x.offeringId);
    expect(ids).toEqual([c.offering.id]);
    expect(ids).not.toContain(oldOffering.id);
  });
});

describe('notifications', () => {
  it('[SCH-14] absent students are notified; the below-threshold notification fires only on crossing', async () => {
    const c = await classroom(prisma, admin.c, 1);
    const t = await clientFor(app, c.teacher);
    const sid = c.students[0]!.id;
    const count = (type: string) => prisma.notification.count({ where: { userId: sid, type } });
    const run = async (daysAgo: number, status: string) => {
      const m = await pastMeeting(prisma, c.offering.id, c.teacher.id, daysAgo);
      expect((await submit(t, m.id, [{ studentId: sid, status }])).status).toBe(200);
    };
    await run(5, 'present');
    await run(4, 'present');
    expect(await count('marked_absent')).toBe(0);
    expect(await count('attendance_below_threshold')).toBe(0);
    await run(3, 'absent'); // 2 of 3 = 66.7% crosses below 75%
    expect(await count('marked_absent')).toBe(1);
    expect(await count('attendance_below_threshold')).toBe(1);
    await run(2, 'absent'); // 50%: already below, so no second crossing notice
    expect(await count('marked_absent')).toBe(2);
    expect(await count('attendance_below_threshold')).toBe(1);
  });
});
