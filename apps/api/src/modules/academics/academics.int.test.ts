import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { client } from '../../../../../test/factories';
import { adminClient, clientFor, fillStudents, makeApp, makeCourse, makeSessionViaApi, makeTeacher, sessionNameSeq } from '../../../../../test/m3kit';

const app = makeApp();
let admin: Awaited<ReturnType<typeof adminClient>>;
beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterAll(() => prisma.$disconnect());

const put = (path: string, body: object) => admin.c.put(path, body);

describe('sessions, groups, sections', () => {
  it('[ACAD-01] session creates 3 groups with Section A; duplicate name rejected', async () => {
    const name = sessionNameSeq();
    const res = await admin.c.post('/api/academics/sessions', { name: name.replace('–', '-') }); // hyphen accepted, stored with en dash
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
    expect(res.body.groups.map((g: { type: string }) => g.type).sort()).toEqual(['arts', 'commerce', 'science']);
    for (const g of res.body.groups) expect(g.sections).toEqual([expect.objectContaining({ name: 'A', classLevel: 11 })]);
    expect(await prisma.group.count({ where: { sessionId: res.body.id } })).toBe(3);
    expect(await prisma.section.count({ where: { group: { sessionId: res.body.id }, name: 'A', classLevel: 11 } })).toBe(3);
    // group + section chat rooms exist from the start
    expect(await prisma.conversation.count({ where: { type: 'group', refId: { in: res.body.groups.map((g: { id: string }) => g.id) } } })).toBe(3);
    expect(await prisma.conversation.count({ where: { type: 'section' } })).toBeGreaterThanOrEqual(3);

    const dup = await admin.c.post('/api/academics/sessions', { name });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    expect(await prisma.group.count({ where: { sessionId: res.body.id } })).toBe(3); // nothing extra created
    expect((await admin.c.post('/api/academics/sessions', { name: '2024/25' })).status).toBe(400);

    // deny: teacher and student cannot create sessions; anonymous gets 401
    const t = await clientFor(app, await makeTeacher(prisma));
    expect((await t.post('/api/academics/sessions', { name: sessionNameSeq() })).status).toBe(403);
    expect((await client(app).post('/api/academics/sessions', { name })).status).toBe(401);
  });

  it('section create is unique per group and class; delete only when empty', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const g = tree.groups.science.id;
    expect((await admin.c.post(`/api/academics/groups/${g}/sections`, { name: 'A', classLevel: 11 })).status).toBe(409);
    const ok = await admin.c.post(`/api/academics/groups/${g}/sections`, { name: 'A', classLevel: 12 });
    expect(ok.status).toBe(201);
    const b = await admin.c.post(`/api/academics/groups/${g}/sections`, { name: 'B', classLevel: 11 });
    await fillStudents(prisma, b.body.id, 1);
    const blocked = await admin.c.delete(`/api/academics/sections/${b.body.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('SECTION_NOT_EMPTY');
    expect((await admin.c.delete(`/api/academics/sections/${ok.body.id}`)).status).toBe(200);
    expect((await prisma.section.findUnique({ where: { id: ok.body.id } }))?.deletedAt).not.toBeNull();
    // the name is free again after a soft delete
    expect((await admin.c.post(`/api/academics/groups/${g}/sections`, { name: 'A', classLevel: 12 })).status).toBe(201);
  });

  it('section page shows free places and is hidden from unrelated teachers', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const sid = tree.groups.arts.sectionId;
    await fillStudents(prisma, sid, 3);
    await fillStudents(prisma, sid, 2, 'inactive');
    const res = await admin.c.get(`/api/academics/sections/${sid}`);
    expect(res.status).toBe(200);
    expect(res.body.freePlaces).toBe(27);
    const stranger = await clientFor(app, await makeTeacher(prisma));
    expect((await stranger.get(`/api/academics/sections/${sid}`)).status).toBe(404);
  });
});

describe('mentor and chat membership', () => {
  it('[ACAD-06] one mentor per section / section per mentor; chat membership synced', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const sec1 = tree.groups.science.sectionId;
    const sec2 = (await admin.c.post(`/api/academics/groups/${tree.groups.science.id}/sections`, { name: 'B', classLevel: 11 })).body.id as string;
    const t1 = await makeTeacher(prisma);
    const t2 = await makeTeacher(prisma);
    const conv = async (type: 'group' | 'section', refId: string) => (await prisma.conversation.findUniqueOrThrow({ where: { type_refId: { type, refId } } })).id;
    const member = async (userId: string, convId: string) => {
      const m = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: convId, userId } } });
      return !!m && m.leftAt === null;
    };
    const secChat = await conv('section', sec1);
    const grpChat = await conv('group', tree.groups.science.id);

    expect((await admin.c.patch(`/api/academics/sections/${sec1}`, { mentorTeacherId: t1.id })).status).toBe(200);
    expect(await member(t1.id, secChat)).toBe(true);
    expect(await member(t1.id, grpChat)).toBe(true);
    expect(await prisma.notification.count({ where: { userId: t1.id, type: 'mentor_assigned' } })).toBe(1);

    // a teacher mentors at most one section
    const twice = await admin.c.patch(`/api/academics/sections/${sec2}`, { mentorTeacherId: t1.id });
    expect(twice.status).toBe(409);
    expect((await prisma.section.findUniqueOrThrow({ where: { id: sec1 } })).mentorTeacherId).toBe(t1.id);

    // t1 also teaches in sec1: when replaced as mentor stays in the section chat, leaves the group chat
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    expect((await put(`/api/academics/sections/${sec1}/offerings`, { items: [{ courseId: course.id, teacherId: t1.id }] })).status).toBe(200);
    expect((await admin.c.patch(`/api/academics/sections/${sec1}`, { mentorTeacherId: t2.id })).status).toBe(200);
    expect(await member(t2.id, secChat)).toBe(true);
    expect(await member(t2.id, grpChat)).toBe(true);
    expect(await member(t1.id, secChat)).toBe(true);
    expect(await member(t1.id, grpChat)).toBe(false);
    expect(await prisma.notification.count({ where: { userId: t1.id, type: 'mentor_assigned' } })).toBe(2); // assigned + replaced
    expect(await prisma.notification.count({ where: { userId: t2.id, type: 'mentor_assigned' } })).toBe(1);

    // t1 loses the offering: leaves the section chat too (computed, not patched)
    expect((await put(`/api/academics/sections/${sec1}/offerings`, { items: [] })).status).toBe(200);
    expect(await member(t1.id, secChat)).toBe(false);

    // unassign
    expect((await admin.c.patch(`/api/academics/sections/${sec1}`, { mentorTeacherId: null })).status).toBe(200);
    expect(await member(t2.id, grpChat)).toBe(false);
    const alerts = await admin.c.get('/api/academics/alerts/sections-without-mentor');
    expect(alerts.body.items.map((s: { id: string }) => s.id)).toContain(sec1);

    // deny: a non-admin cannot assign
    const tc = await clientFor(app, t1);
    expect((await tc.patch(`/api/academics/sections/${sec1}`, { mentorTeacherId: t1.id })).status).toBe(403);
  });
});

describe('catalog and chapters', () => {
  it('course create/archive, chapter rules and reorder', async () => {
    const code = `CAT-${Date.now()}`;
    const created = await admin.c.post('/api/academics/courses', { code, name: 'Physics 1st', groupType: 'science', classLevel: 'c11', paper: 'first' });
    expect(created.status).toBe(201);
    expect((await admin.c.post('/api/academics/courses', { code, name: 'Dup', groupType: 'science', classLevel: 'c11' })).status).toBe(409);
    const cid = created.body.id as string;

    const ch1 = await admin.c.post(`/api/academics/courses/${cid}/chapters`, { name: 'Motion' });
    const ch2 = await admin.c.post(`/api/academics/courses/${cid}/chapters`, { name: 'Force' });
    expect([ch1.status, ch2.status]).toEqual([201, 201]);
    expect((await admin.c.post(`/api/academics/courses/${cid}/chapters`, { name: 'Force' })).status).toBe(409);
    expect((await put(`/api/academics/courses/${cid}/chapters/order`, { ids: [ch2.body.id, ch1.body.id] })).status).toBe(200);
    const list = await admin.c.get(`/api/academics/courses/${cid}/chapters`);
    expect(list.body.items.map((c: { name: string }) => c.name)).toEqual(['Force', 'Motion']);
    expect((await put(`/api/academics/courses/${cid}/chapters/order`, { ids: [ch1.body.id] })).status).toBe(400);

    // a teacher may add a chapter only to a course they teach; others are denied
    const tree = await makeSessionViaApi(admin.c);
    const teacher = await makeTeacher(prisma);
    const other = await makeTeacher(prisma);
    await put(`/api/academics/sections/${tree.groups.science.sectionId}/offerings`, { items: [{ courseId: cid, teacherId: teacher.id }] });
    const tc = await clientFor(app, teacher);
    expect((await tc.post(`/api/academics/courses/${cid}/chapters`, { name: 'Energy' })).status).toBe(201);
    expect((await (await clientFor(app, other)).post(`/api/academics/courses/${cid}/chapters`, { name: 'Heat' })).status).toBe(403);
    expect((await (await clientFor(app, other)).get(`/api/academics/courses/${cid}/chapters`)).status).toBe(404);
    expect((await tc.patch(`/api/academics/chapters/${ch1.body.id}`, { name: 'x' })).status).toBe(403); // rename is Admin only

    // delete: blocked when used, allowed when unused
    await prisma.material.create({ data: { scope: 'college', courseId: cid, chapterId: ch1.body.id, title: 'Notes', createdBy: teacher.id } });
    const used = await admin.c.delete(`/api/academics/chapters/${ch1.body.id}`);
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('CHAPTER_IN_USE');
    expect((await admin.c.delete(`/api/academics/chapters/${ch2.body.id}`)).status).toBe(200);

    const archived = await admin.c.patch(`/api/academics/courses/${cid}`, { archived: true });
    expect(archived.body.archivedAt).not.toBeNull();
  });
});

describe('offerings', () => {
  async function section() {
    const tree = await makeSessionViaApi(admin.c);
    return { tree, sid: tree.groups.science.sectionId };
  }
  const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const time = (h: string) => new Date(`1970-01-01T${h}:00Z`);

  it('PUT offerings is a diff: create, change teacher, end; ending enrolls and un-enrolls', async () => {
    const { sid } = await section();
    const [a, b] = [await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' }), await makeCourse(prisma, { groupType: 'common' })];
    const t1 = await makeTeacher(prisma);
    const t2 = await makeTeacher(prisma);
    const students = await fillStudents(prisma, sid, 2);
    const r1 = await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: a.id, teacherId: t1.id }, { courseId: b.id, teacherId: t1.id }] });
    expect(r1.body).toEqual({ created: 2, updated: 0, ended: 0 });
    expect(await prisma.enrollment.count({ where: { studentId: { in: students.map((s) => s.id) }, status: 'active' } })).toBe(4);
    expect(await prisma.notification.count({ where: { userId: t1.id, type: 'course_assignment_changed' } })).toBe(1); // one per teacher per save
    const r2 = await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: a.id, teacherId: t2.id }] });
    expect(r2.body).toEqual({ created: 0, updated: 1, ended: 1 });
    const ended = await prisma.courseOffering.findUniqueOrThrow({ where: { sectionId_courseId: { sectionId: sid, courseId: b.id } } });
    expect(ended.endedAt).not.toBeNull();
    expect(await prisma.enrollment.count({ where: { courseOfferingId: ended.id, status: 'active' } })).toBe(0);
    // a course of the wrong group does not fit
    const wrong = await makeCourse(prisma, { groupType: 'arts' });
    expect((await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: wrong.id, teacherId: t1.id }] })).status).toBe(400);
    // deny: teacher cannot assign
    expect((await (await clientFor(app, t1)).put(`/api/academics/sections/${sid}/offerings`, { items: [] })).status).toBe(403);
    // suggestions mark offered courses
    const sug = await admin.c.get(`/api/academics/sections/${sid}/course-suggestions`);
    expect(sug.body.items.find((c: { id: string }) => c.id === a.id).offered).toBe(true);
    expect(sug.body.items.find((c: { id: string }) => c.id === wrong.id)).toBeUndefined();
  });

  it('[ACAD-05] teacher change keeps content, reassigns only future meetings without attendance', async () => {
    const { sid } = await section();
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    const t1 = await makeTeacher(prisma);
    const t2 = await makeTeacher(prisma);
    const [s1] = await fillStudents(prisma, sid, 1);
    await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: course.id, teacherId: t1.id }] });
    const off = await prisma.courseOffering.findUniqueOrThrow({ where: { sectionId_courseId: { sectionId: sid, courseId: course.id } } });
    const material = await prisma.material.create({ data: { scope: 'offering', courseOfferingId: off.id, title: 'Slides', createdBy: t1.id } });
    const mk = async (date: string, taken: boolean) => {
      const m = await prisma.classMeeting.create({
        data: { date: new Date(date), startTime: time('09:00'), endTime: time('09:45'), teacherId: t1.id, attendanceTakenAt: taken ? new Date() : null, offerings: { create: { courseOfferingId: off.id } } },
      });
      return m.id;
    };
    const past = await mk(ymd(-3), false);
    const futureOpen = await mk(ymd(3), false);
    const futureTaken = await mk(ymd(4), true);

    const r = await admin.c.patch(`/api/academics/offerings/${off.id}`, { teacherId: t2.id });
    expect(r.status).toBe(200);
    const teacherOf = async (id: string) => (await prisma.classMeeting.findUniqueOrThrow({ where: { id } })).teacherId;
    expect(await teacherOf(futureOpen)).toBe(t2.id);
    expect(await teacherOf(past)).toBe(t1.id);
    expect(await teacherOf(futureTaken)).toBe(t1.id);
    // content stays with the offering, enrollment unchanged
    const m = await prisma.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(m.courseOfferingId).toBe(off.id);
    expect((await prisma.courseOffering.findUniqueOrThrow({ where: { id: off.id } })).teacherId).toBe(t2.id);
    expect(await prisma.enrollment.count({ where: { courseOfferingId: off.id, studentId: s1!.id, status: 'active' } })).toBe(1);
    // both teachers are told; the old teacher leaves the section chat
    expect(await prisma.notification.count({ where: { userId: t2.id, type: 'course_assignment_changed' } })).toBe(1);
    const chat = await prisma.conversation.findUniqueOrThrow({ where: { type_refId: { type: 'section', refId: sid } } });
    const left = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: chat.id, userId: t1.id } } });
    expect(left?.leftAt).not.toBeNull();
  });

  it('ending an offering with a running exam attempt is blocked', async () => {
    const { sid } = await section();
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    const t = await makeTeacher(prisma);
    const [s] = await fillStudents(prisma, sid, 1);
    await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: course.id, teacherId: t.id }] });
    const off = await prisma.courseOffering.findUniqueOrThrow({ where: { sectionId_courseId: { sectionId: sid, courseId: course.id } } });
    const exam = await prisma.exam.create({
      data: { courseOfferingId: off.id, createdBy: t.id, kind: 'exam', title: 'E', startAt: new Date(Date.now() - 3600_000), endAt: new Date(Date.now() + 3600_000), durationMin: 30, totalMarks: 10, passMarks: 4, status: 'published' },
    });
    await prisma.examAttempt.create({
      data: { examId: exam.id, studentId: s!.id, attemptNo: 1, sectionId: sid, deadlineAt: new Date(Date.now() + 1800_000), questionOrder: [], status: 'in_progress' },
    });
    const r = await put(`/api/academics/sections/${sid}/offerings`, { items: [] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ATTEMPT_IN_PROGRESS');
    expect((await prisma.courseOffering.findUniqueOrThrow({ where: { id: off.id } })).endedAt).toBeNull();
  });

  it('[ACAD-07] copy assignments only matching group/class', async () => {
    const src = await section(); // science, class 11
    const sci11 = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    const common = await makeCourse(prisma, { groupType: 'common', classLevel: 'both' });
    const t = await makeTeacher(prisma);
    await fillStudents(prisma, src.sid, 2);
    await put(`/api/academics/sections/${src.sid}/offerings`, { items: [{ courseId: sci11.id, teacherId: t.id }, { courseId: common.id, teacherId: t.id }] });

    // different group, same class: only the common course matches
    const arts = src.tree.groups.arts.sectionId;
    const r1 = await admin.c.post(`/api/academics/sections/${arts}/offerings/copy`, { fromSectionId: src.sid });
    expect(r1.body).toEqual({ copied: 1, skipped: 1 });
    expect((await prisma.courseOffering.findMany({ where: { sectionId: arts } })).map((o) => o.courseId)).toEqual([common.id]);
    // same group, other class (12): the c11 course is skipped, the "both" course copies
    const sci12 = (await admin.c.post(`/api/academics/groups/${src.tree.groups.science.id}/sections`, { name: 'A', classLevel: 12 })).body.id as string;
    const r2 = await admin.c.post(`/api/academics/sections/${sci12}/offerings/copy`, { fromSectionId: src.sid });
    expect(r2.body).toEqual({ copied: 1, skipped: 1 });
    // never copies students or content
    expect(await prisma.enrollment.count({ where: { courseOffering: { sectionId: { in: [arts, sci12] } } } })).toBe(0);
    // copying again changes nothing
    expect((await admin.c.post(`/api/academics/sections/${arts}/offerings/copy`, { fromSectionId: src.sid })).body.copied).toBe(0);
    expect((await (await clientFor(app, t)).post(`/api/academics/sections/${arts}/offerings/copy`, { fromSectionId: src.sid })).status).toBe(403);
  });

  it('[ACAD-08] optional course enrolls chosen students (default all)', async () => {
    const { sid } = await section();
    const opt = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11', isOptional: true });
    const core = await makeCourse(prisma, { groupType: 'common' });
    const t = await makeTeacher(prisma);
    const [a, b, c] = await fillStudents(prisma, sid, 3);
    // default: everybody
    await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: opt.id, teacherId: t.id }] });
    const off = await prisma.courseOffering.findUniqueOrThrow({ where: { sectionId_courseId: { sectionId: sid, courseId: opt.id } } });
    const active = (offeringId: string) => prisma.enrollment.findMany({ where: { courseOfferingId: offeringId, status: 'active' }, select: { studentId: true } }).then((r) => r.map((x) => x.studentId).sort());
    expect(await active(off.id)).toEqual([a!.id, b!.id, c!.id].sort());
    // choose two
    expect((await admin.c.put(`/api/academics/offerings/${off.id}/students`, { studentIds: [a!.id, c!.id] })).status).toBe(200);
    expect(await active(off.id)).toEqual([a!.id, c!.id].sort());
    expect((await prisma.enrollment.findMany({ where: { courseOfferingId: off.id, studentId: b!.id } })).every((e) => e.status === 'ended')).toBe(true);
    // new optional offering in the PUT with a chosen list
    const opt2 = await makeCourse(prisma, { groupType: 'common', isOptional: true });
    await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: opt.id, teacherId: t.id }, { courseId: opt2.id, teacherId: t.id, optionalStudentIds: [b!.id] }] });
    const off2 = await prisma.courseOffering.findUniqueOrThrow({ where: { sectionId_courseId: { sectionId: sid, courseId: opt2.id } } });
    expect(await active(off2.id)).toEqual([b!.id]);
    // non-optional courses reject a student list; students from another section are refused
    await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: core.id, teacherId: t.id }] });
    const coreOff = await prisma.courseOffering.findUniqueOrThrow({ where: { sectionId_courseId: { sectionId: sid, courseId: core.id } } });
    expect((await admin.c.put(`/api/academics/offerings/${coreOff.id}/students`, { studentIds: [a!.id] })).status).toBe(400);
    const stranger = (await fillStudents(prisma, (await makeSessionViaApi(admin.c)).groups.arts.sectionId, 1))[0]!;
    await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: opt.id, teacherId: t.id }] });
    const r = await admin.c.put(`/api/academics/offerings/${off.id}/students`, { studentIds: [stranger.id] });
    expect(r.status).toBe(400);
  });
});

describe('[ACAD-11] closed session is read-only', () => {
  it('every write into a closed session returns 409 SESSION_CLOSED', async () => {
    const tree = await makeSessionViaApi(admin.c);
    const sid = tree.groups.science.sectionId;
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    const t = await makeTeacher(prisma);
    const [student] = await fillStudents(prisma, sid, 1);
    await put(`/api/academics/sections/${sid}/offerings`, { items: [{ courseId: course.id, teacherId: t.id }] });
    const off = await prisma.courseOffering.findUniqueOrThrow({ where: { sectionId_courseId: { sectionId: sid, courseId: course.id } } });
    const openTree = await makeSessionViaApi(admin.c); // open session for the move source
    const [roamer] = await fillStudents(prisma, openTree.groups.science.sectionId, 1);
    const t2 = await makeTeacher(prisma);

    expect((await admin.c.post(`/api/academics/sessions/${tree.sessionId}/close`, { confirm: true })).status).toBe(200);

    const table: [string, string, string, object][] = [
      ['rename session', 'patch', `/api/academics/sessions/${tree.sessionId}`, { name: sessionNameSeq() }],
      ['close again', 'post', `/api/academics/sessions/${tree.sessionId}/close`, { confirm: true }],
      ['create section', 'post', `/api/academics/groups/${tree.groups.science.id}/sections`, { name: 'Z', classLevel: 11 }],
      ['rename section', 'patch', `/api/academics/sections/${sid}`, { name: 'Q' }],
      ['assign mentor', 'patch', `/api/academics/sections/${sid}`, { mentorTeacherId: t2.id }],
      ['delete section', 'delete', `/api/academics/sections/${sid}`, {}],
      ['put offerings', 'put', `/api/academics/sections/${sid}/offerings`, { items: [] }],
      ['copy offerings', 'post', `/api/academics/sections/${sid}/offerings/copy`, { fromSectionId: openTree.groups.science.sectionId }],
      ['change teacher', 'patch', `/api/academics/offerings/${off.id}`, { teacherId: t2.id }],
      ['optional students', 'put', `/api/academics/offerings/${off.id}/students`, { studentIds: [] }],
      ['create student', 'post', '/api/users/students', { name: 'N', roll: '77', email: `${Date.now()}c@x.test`, sectionId: sid }],
      ['edit student', 'patch', `/api/users/${student!.id}`, { roll: '88' }],
      ['reset password', 'post', `/api/users/${student!.id}/reset-password`, {}],
      ['deactivate student', 'post', `/api/users/${student!.id}/deactivate`, {}],
      ['move into closed', 'post', '/api/users/students/move', { studentIds: [roamer!.id], targetSectionId: sid }],
    ];
    for (const [label, method, url, body] of table) {
      const r = await admin.c.req(method as 'post', url, body);
      expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(409);
      expect(r.body.error.code, label).toBe('SESSION_CLOSED');
    }
    // reading stays possible and nothing changed
    expect((await admin.c.get(`/api/academics/sections/${sid}`)).status).toBe(200);
    expect((await prisma.section.findUniqueOrThrow({ where: { id: sid } })).name).toBe('A');
  });
});
