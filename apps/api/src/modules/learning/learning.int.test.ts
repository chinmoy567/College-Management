import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prisma } from '../../db';
import { setClock } from '../../lib/clock';
import { flushNotifications } from '../../lib/notify';
import { adminClient, classroom, clientFor, makeApp, makeTeacher, uniq } from '../../../../../test/m5kit';

const app = makeApp();
let admin: Awaited<ReturnType<typeof adminClient>>;
type Room = Awaited<ReturnType<typeof classroom>>;
beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterAll(() => prisma.$disconnect());
afterEach(() => setClock(null));

const PDF = Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const EXE = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'binary'), Buffer.alloc(200)]);
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const H = 3_600_000;
const M = 60_000;

const asTeacher = (r: Room) => clientFor(app, r.teacher);
const asStudent = (r: Room, i = 0) => clientFor(app, r.students[i]!);
const notes = (userId: string, type: string) => prisma.notification.count({ where: { userId, type } });
const mkChapter = (courseId: string, name = uniq('Ch')) => prisma.chapter.create({ data: { courseId, name, order: 1, createdById: admin.admin.id } });
const mkOnline = async (r: Room, over: object = {}) => {
  const t = await asTeacher(r);
  const res = await t.post('/api/classes/online', { offeringIds: [r.offering.id], title: 'Physics live', startAt: iso(H), durationMin: 60, joinUrl: 'https://meet.google.com/abc-defg-hij', ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { t, id: res.body.id as string };
};

describe('online classes', () => {
  it('[LRN-01] a student who is not enrolled never receives joinUrl', async () => {
    const r = await classroom(prisma, admin.c);
    const other = await classroom(prisma, admin.c);
    const { id } = await mkOnline(r);
    const inside = await (await asStudent(r)).get('/api/classes/online');
    expect(inside.body.items.find((c: { id: string }) => c.id === id).joinUrl).toBe('https://meet.google.com/abc-defg-hij');
    const outsider = await asStudent(other);
    const list = await outsider.get('/api/classes/online');
    expect(JSON.stringify(list.body)).not.toContain('meet.google.com');
    expect(list.body.items.find((c: { id: string }) => c.id === id)).toBeUndefined();
    expect((await outsider.post(`/api/classes/online/${id}/join`)).status).toBe(404);
    // the offering filter cannot be used to peek either
    expect(JSON.stringify((await outsider.get(`/api/classes/online?offeringId=${r.offering.id}`)).body)).not.toContain('meet.google.com');
  });

  it('[LRN-02] join works only from start-10 min to the end; each click is logged', async () => {
    const r = await classroom(prisma, admin.c);
    const { id, t } = await mkOnline(r);
    const s = await asStudent(r);
    const start = (await prisma.onlineClass.findUniqueOrThrow({ where: { id } })).startAt.getTime();
    setClock(() => new Date(start - 11 * M));
    const early = await s.post(`/api/classes/online/${id}/join`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('JOIN_NOT_OPEN');
    setClock(() => new Date(start - 9 * M));
    const ok = await s.post(`/api/classes/online/${id}/join`);
    expect(ok.status).toBe(200);
    expect(ok.body.joinUrl).toContain('meet.google.com');
    setClock(() => new Date(start + 30 * M));
    expect((await s.post(`/api/classes/online/${id}/join`)).status).toBe(200);
    setClock(() => new Date(start + 61 * M));
    expect((await s.post(`/api/classes/online/${id}/join`)).status).toBe(409);
    expect(await prisma.onlineClassJoin.count({ where: { onlineClassId: id } })).toBe(2);
    const joins = await t.get(`/api/classes/online/${id}/joins`);
    expect(joins.status).toBe(200);
    expect(joins.body.items).toHaveLength(2);
    expect((await s.get(`/api/classes/online/${id}/joins`)).status).toBe(404);
    // status is derived from time, not stored
    expect((await s.get('/api/classes/online')).body.items[0].status).toBe('ended');
  });

  it('[LRN-03] reschedule and cancel notify the students and re-link or detach the meetings', async () => {
    const r = await classroom(prisma, admin.c);
    const { id, t } = await mkOnline(r);
    await flushNotifications();
    const kid = r.students[0]!.id;
    expect(await notes(kid, 'online_class_scheduled')).toBe(1);
    expect(await prisma.classMeeting.count({ where: { onlineClassId: id } })).toBeGreaterThan(0);

    const moved = await t.patch(`/api/classes/online/${id}`, { startAt: iso(3 * 24 * H), title: 'Moved class' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(await notes(kid, 'online_class_changed')).toBe(1);
    const linked = await prisma.classMeeting.findMany({ where: { onlineClassId: id, status: 'scheduled' } });
    expect(linked).toHaveLength(1);
    expect((await prisma.onlineClass.findUniqueOrThrow({ where: { id } })).title).toBe('Moved class');

    expect((await t.post(`/api/classes/online/${id}/cancel`)).status).toBe(200);
    expect(await notes(kid, 'online_class_cancelled')).toBe(1);
    expect(await prisma.classMeeting.count({ where: { onlineClassId: id, status: 'scheduled' } })).toBe(0);
    expect((await (await asStudent(r)).post(`/api/classes/online/${id}/join`)).status).toBe(409);
    expect((await t.patch(`/api/classes/online/${id}`, { title: 'Again' })).status).toBe(409);
  });

  it('[LRN-03] only the teacher of every offering can schedule; link must be https; start must be in the future', async () => {
    const r = await classroom(prisma, admin.c);
    const o = await classroom(prisma, admin.c);
    const t = await asTeacher(r);
    const base = { title: 'x', startAt: iso(H), durationMin: 60, joinUrl: 'https://meet.jit.si/Room' };
    expect((await t.post('/api/classes/online', { ...base, offeringIds: [r.offering.id, o.offering.id] })).status).toBe(403);
    expect((await t.post('/api/classes/online', { ...base, offeringIds: [r.offering.id], joinUrl: 'http://meet.jit.si/x' })).status).toBe(400);
    expect((await t.post('/api/classes/online', { ...base, offeringIds: [r.offering.id], startAt: iso(-H) })).status).toBe(400);
    expect((await t.post('/api/classes/online', { ...base, offeringIds: [r.offering.id], durationMin: 10 })).status).toBe(400);
    expect((await (await asStudent(r)).post('/api/classes/online', { ...base, offeringIds: [r.offering.id] })).status).toBe(403);
    const ok = await t.post('/api/classes/online', { ...base, offeringIds: [r.offering.id] });
    expect((await prisma.onlineClass.findUniqueOrThrow({ where: { id: ok.body.id } })).platform).toBe('jitsi');
  });
});

describe('recordings', () => {
  const YT = 'https://youtu.be/dQw4w9WgXcQ';
  it('[LRN-04] accepts YouTube and Drive links, rejects other hosts; a chapter of another course is rejected', async () => {
    const r = await classroom(prisma, admin.c);
    const t = await asTeacher(r);
    const body = { courseOfferingId: r.offering.id, courseId: r.course.id, title: 'Lec 1', visibility: 'section' };
    expect((await t.post('/api/materials/recordings', { ...body, url: YT })).status).toBe(201);
    expect((await t.post('/api/materials/recordings', { ...body, url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view' })).status).toBe(201);
    const bad = await t.post('/api/materials/recordings', { ...body, url: 'https://vimeo.com/123456' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('UNSUPPORTED_VIDEO_URL');
    const otherCourse = await classroom(prisma, admin.c);
    const foreign = await mkChapter(otherCourse.course.id);
    expect((await t.post('/api/materials/recordings', { ...body, url: YT, chapterId: foreign.id })).status).toBe(400);
    const own = await mkChapter(r.course.id);
    expect((await t.post('/api/materials/recordings', { ...body, url: YT, chapterId: own.id })).status).toBe(201);
    // a teacher cannot add to someone else's offering
    expect((await (await asTeacher(otherCourse)).post('/api/materials/recordings', { ...body, url: YT })).status).toBe(403);
  });

  it('[LRN-07] college-wide recordings are visible to all students, section ones only to that section', async () => {
    const r = await classroom(prisma, admin.c);
    const o = await classroom(prisma, admin.c);
    const t = await asTeacher(r);
    const base = { courseOfferingId: r.offering.id, courseId: r.course.id, url: YT0 };
    const sec = (await t.post('/api/materials/recordings', { ...base, title: 'Section only', visibility: 'section' })).body.id as string;
    const free = (await t.post('/api/materials/recordings', { ...base, title: 'Free for all', visibility: 'college' })).body.id as string;
    const adminFree = await admin.c.post('/api/materials/recordings', { courseId: o.course.id, title: 'Admin library', url: YT0, visibility: 'college' });
    expect(adminFree.status, JSON.stringify(adminFree.body)).toBe(201);
    expect((await admin.c.post('/api/materials/recordings', { courseId: o.course.id, title: 'x', url: YT0, visibility: 'section' })).status).toBe(400);

    const inList = async (c: Awaited<ReturnType<typeof asStudent>>) => ((await c.get('/api/materials/recordings')).body.items as { id: string }[]).map((x) => x.id);
    const mine = await inList(await asStudent(r));
    expect(mine).toEqual(expect.arrayContaining([sec, free, adminFree.body.id]));
    const outsider = await inList(await asStudent(o));
    expect(outsider).toContain(free);
    expect(outsider).toContain(adminFree.body.id);
    expect(outsider).not.toContain(sec);
    expect((await (await asStudent(o)).post(`/api/materials/recordings/${sec}/opened`)).status).toBe(404);
    expect((await (await asStudent(o)).post(`/api/materials/recordings/${free}/opened`)).status).toBe(200);
  });

  it('[LRN-08] a new recording notifies the enrolled students; opening marks it watched', async () => {
    const r = await classroom(prisma, admin.c);
    const t = await asTeacher(r);
    const rec = await t.post('/api/materials/recordings', { courseOfferingId: r.offering.id, courseId: r.course.id, title: 'Watch me', url: YT0, visibility: 'section' });
    await flushNotifications();
    for (const s of r.students) expect(await notes(s.id, 'recording_new')).toBe(1);
    const s = await asStudent(r);
    const pick = async () => ((await s.get('/api/materials/recordings')).body.items as { id: string; watched: boolean; embedUrl: string }[]).find((x) => x.id === rec.body.id)!;
    expect((await pick()).watched).toBe(false);
    expect((await s.post(`/api/materials/recordings/${rec.body.id}/opened`)).status).toBe(200);
    expect((await s.post(`/api/materials/recordings/${rec.body.id}/opened`)).status).toBe(200);
    const after = await pick();
    expect(after.watched).toBe(true);
    expect(after.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(await prisma.recordingProgress.count({ where: { recordedClassId: rec.body.id } })).toBe(1);
    // soft delete hides it
    expect((await t.delete(`/api/materials/recordings/${rec.body.id}`)).status).toBe(200);
    expect(((await s.get('/api/materials/recordings')).body.items as { id: string }[]).some((x) => x.id === rec.body.id)).toBe(false);
  });
});
const YT0 = 'https://youtu.be/dQw4w9WgXcQ';

const upload = (c: Awaited<ReturnType<typeof clientFor>>, fields: Record<string, string>, files: { name: string; buf: Buffer; field?: string }[], url = '/api/materials') => {
  const rq = c.req('post', url);
  for (const [k, v] of Object.entries(fields)) rq.field(k, v);
  for (const f of files) rq.attach(f.field ?? 'files', f.buf, { filename: f.name });
  return rq;
};

describe('materials', () => {
  it('[LRN-05] another section never lists or opens an offering material; the signed URL comes after the check; views and downloads are counted', async () => {
    const r = await classroom(prisma, admin.c);
    const o = await classroom(prisma, admin.c);
    const t = await asTeacher(r);
    const made = await upload(t, { scope: 'offering', courseOfferingId: r.offering.id, title: 'Chapter 1 notes' }, [{ name: 'notes.pdf', buf: PDF }]);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const mat = made.body.id as string;
    const list = await (await asStudent(r)).get('/api/materials');
    const item = list.body.items.find((m: { id: string }) => m.id === mat);
    expect(item.files).toHaveLength(1);
    const fileId = item.files[0].id as string;

    const out = await asStudent(o);
    expect((await out.get('/api/materials')).body.items.find((m: { id: string }) => m.id === mat)).toBeUndefined();
    expect((await out.get(`/api/materials/${mat}/files/${fileId}`)).status).toBe(404);
    expect(await prisma.materialView.count({ where: { materialId: mat } })).toBe(0);

    const s = await asStudent(r);
    const view = await s.get(`/api/materials/${mat}/files/${fileId}`);
    expect(view.status).toBe(302);
    expect(view.headers.location).toMatch(/^https:\/\/storage\.test\/sign\/private\/material\//);
    expect(view.headers.location).not.toContain('download=');
    const dl = await s.get(`/api/materials/${mat}/files/${fileId}?action=download`);
    expect(dl.status).toBe(302);
    expect(dl.headers.location).toContain('download=');
    await (await asStudent(r, 1)).get(`/api/materials/${mat}/files/${fileId}`);

    const stats = await t.get(`/api/materials/${mat}/stats`);
    expect(stats.body).toEqual({ views: 2, downloads: 1, uniqueViewers: 2, uniqueDownloaders: 1 });
    expect((await s.get(`/api/materials/${mat}/stats`)).status).toBe(403);
    // someone else's teacher cannot manage or delete it
    expect((await (await asTeacher(o)).delete(`/api/materials/${mat}`)).status).toBe(404);
    expect((await t.delete(`/api/materials/${mat}`)).status).toBe(200);
    expect((await s.get(`/api/materials/${mat}/files/${fileId}`)).status).toBe(404);
    expect((await prisma.storageObject.findMany({ where: { materialFiles: { some: { materialId: mat } } } })).every((x) => x.deletedAt)).toBe(true);
  });

  it('[LRN-06] files are checked by content (a renamed exe is rejected) and by size', async () => {
    const r = await classroom(prisma, admin.c);
    const t = await asTeacher(r);
    const f = { scope: 'offering', courseOfferingId: r.offering.id, title: 'Bad' };
    const before = await prisma.material.count();
    const exe = await upload(t, f, [{ name: 'notes.pdf', buf: EXE }]);
    expect(exe.status).toBe(400);
    const exeDoc = await upload(t, f, [{ name: 'slides.pptx', buf: EXE }]);
    expect(exeDoc.status).toBe(400);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    expect((await upload(t, f, [{ name: 'scan.pdf', buf: png }])).status).toBe(400);
    // one good file then a bad one: nothing is saved
    expect((await upload(t, f, [{ name: 'a.pdf', buf: PDF }, { name: 'b.pdf', buf: EXE }])).status).toBe(400);
    expect(await prisma.material.count()).toBe(before);
    // images are accepted and re-encoded; too large an image is refused
    expect((await upload(t, f, [{ name: 'pic.png', buf: png }])).status).toBe(201);
    const big = await sharp({ create: { width: 3000, height: 3000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
    expect((await upload(t, f, [{ name: 'big.png', buf: big }])).status).toBe(400);
    // more than 10 files
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.pdf`, buf: PDF }));
    expect((await upload(t, f, many)).status).toBe(400);
    // a file or a link is required
    expect((await upload(t, f, [])).status).toBe(400);
    expect((await upload(t, { ...f, linkUrl: 'https://example.com/notes' }, [])).status).toBe(201);
    expect((await upload(t, { ...f, linkUrl: 'http://example.com/notes' }, [])).status).toBe(400);
  });

  it('[LRN-07] college-wide materials are visible to all students; section ones only to that section; scope rules hold', async () => {
    const r = await classroom(prisma, admin.c);
    const o = await classroom(prisma, admin.c);
    const mentor = await makeTeacher(prisma);
    await prisma.section.update({ where: { id: r.sectionId }, data: { mentorTeacherId: mentor.id } });
    const m = await clientFor(app, mentor);
    const sec = await upload(m, { scope: 'section', sectionId: r.sectionId, title: 'Section pack' }, [{ name: 's.pdf', buf: PDF }]);
    expect(sec.status, JSON.stringify(sec.body)).toBe(201);
    // the mentor of another section / a plain teacher cannot
    expect((await upload(await asTeacher(r), { scope: 'section', sectionId: r.sectionId, title: 'x' }, [{ name: 's.pdf', buf: PDF }])).status).toBe(403);
    expect((await upload(m, { scope: 'section', sectionId: o.sectionId, title: 'x' }, [{ name: 's.pdf', buf: PDF }])).status).toBe(403);
    expect((await upload(m, { scope: 'college', title: 'x' }, [{ name: 's.pdf', buf: PDF }])).status).toBe(403);
    expect((await upload(await asTeacher(r), { scope: 'offering', courseOfferingId: o.offering.id, title: 'x' }, [{ name: 's.pdf', buf: PDF }])).status).toBe(403);

    const group = await prisma.section.findUniqueOrThrow({ where: { id: r.sectionId }, select: { groupId: true } });
    const grp = await upload(admin.c, { scope: 'group', groupId: group.groupId, title: 'Group pack' }, [{ name: 'g.pdf', buf: PDF }]);
    const col = await upload(admin.c, { scope: 'college', title: 'Free book' }, [{ name: 'c.pdf', buf: PDF }]);
    expect(grp.status).toBe(201);
    expect(col.status).toBe(201);

    const ids = async (c: Awaited<ReturnType<typeof asStudent>>) => ((await c.get('/api/materials')).body.items as { id: string }[]).map((x) => x.id);
    const mine = await ids(await asStudent(r));
    expect(mine).toEqual(expect.arrayContaining([sec.body.id, grp.body.id, col.body.id]));
    const theirs = await ids(await asStudent(o));
    expect(theirs).toContain(col.body.id);
    expect(theirs).not.toContain(sec.body.id);
    expect(theirs).not.toContain(grp.body.id);
  });

  it('[LRN-08] a new material notifies the enrolled students (offering) or the section', async () => {
    const r = await classroom(prisma, admin.c);
    const t = await asTeacher(r);
    const ch = await mkChapter(r.course.id);
    const made = await upload(t, { scope: 'offering', courseOfferingId: r.offering.id, chapterId: ch.id, title: 'Notes' }, [{ name: 'n.pdf', buf: PDF }]);
    expect(made.status).toBe(201);
    await flushNotifications();
    for (const s of r.students) expect(await notes(s.id, 'material_new')).toBe(1);
    const stranger = await classroom(prisma, admin.c);
    for (const s of stranger.students) expect(await notes(s.id, 'material_new')).toBe(0);
    // a chapter of another course is refused
    const foreign = await mkChapter(stranger.course.id);
    expect((await upload(t, { scope: 'offering', courseOfferingId: r.offering.id, chapterId: foreign.id, title: 'x' }, [{ name: 'n.pdf', buf: PDF }])).status).toBe(400);
    // grouped by chapter in the list
    const item = (await (await asStudent(r)).get('/api/materials')).body.items[0];
    expect(item.chapter).toBe(ch.name);
  });
});

describe('previous questions', () => {
  const body = (courseId: string, over: Record<string, string> = {}) => ({ courseId, year: '2023', examType: 'hsc_board', board: 'Dhaka', ...over });
  it('[LRN-09] previous questions filter by course, year and exam type; uploads are limited to the PRD roles', async () => {
    const r = await classroom(prisma, admin.c);
    const o = await classroom(prisma, admin.c);
    const t = await asTeacher(r);
    const url = '/api/materials/previous-questions';
    const a = await upload(t, body(r.course.id), [{ name: 'q.pdf', buf: PDF }], url);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const withSolution = await upload(t, body(r.course.id, { year: '2022', examType: 'test' }), [{ name: 'q.pdf', buf: PDF }, { name: 'sol.pdf', buf: PDF, field: 'solution' }], url);
    expect(withSolution.status).toBe(201);
    // a teacher of another course cannot upload for this one; a student cannot upload at all
    expect((await upload(await asTeacher(o), body(r.course.id), [{ name: 'q.pdf', buf: PDF }], url)).status).toBe(403);
    expect((await upload(await asStudent(r), body(r.course.id), [{ name: 'q.pdf', buf: PDF }], url)).status).toBe(403);
    // the Admin can upload for any course; a mentor for a course taught in their section
    expect((await upload(admin.c, body(o.course.id, { examType: 'model_test' }), [{ name: 'q.pdf', buf: PDF }], url)).status).toBe(201);
    const mentor = await makeTeacher(prisma);
    await prisma.section.update({ where: { id: r.sectionId }, data: { mentorTeacherId: mentor.id } });
    expect((await upload(await clientFor(app, mentor), body(r.course.id, { year: '2021' }), [{ name: 'q.pdf', buf: PDF }], url)).status).toBe(201);
    // bad inputs
    expect((await upload(t, body(r.course.id), [{ name: 'q.exe', buf: EXE }], url)).status).toBe(400);
    expect((await upload(t, body(r.course.id, { year: '1980' }), [{ name: 'q.pdf', buf: PDF }], url)).status).toBe(400);
    expect((await upload(t, body(r.course.id, { year: '2099' }), [{ name: 'q.pdf', buf: PDF }], url)).status).toBe(400);
    expect((await upload(t, body(r.course.id), [], url)).status).toBe(400);

    const s = await asStudent(r);
    const all = (await s.get(`${url}?courseId=${r.course.id}`)).body.items as { year: number; examType: string }[];
    expect(all.map((x) => x.year)).toEqual([2023, 2022, 2021]);
    expect((await s.get(`${url}?courseId=${r.course.id}&year=2022`)).body.items).toHaveLength(1);
    expect((await s.get(`${url}?courseId=${r.course.id}&examType=hsc_board`)).body.items).toHaveLength(2);
    expect((await s.get(`${url}?courseId=${r.course.id}&year=2023&examType=test`)).body.items).toHaveLength(0);
    // files come through a signed URL after the same check
    const q = (await s.get(`${url}?courseId=${r.course.id}&year=2022`)).body.items[0];
    const file = await s.get(`${url}/${q.id}/files/${q.files[0].id}`);
    expect(file.status).toBe(302);
    expect(file.headers.location).toContain('storage.test/sign/private/previous_question/');
    expect((await s.get(`${url}/${q.id}/files/${q.solutionId}`)).status).toBe(302);
    expect((await s.get(`${url}/${q.id}/files/${r.course.id}`)).status).toBe(404);
    // delete: uploader or Admin only
    expect((await (await asTeacher(o)).delete(`${url}/${q.id}`)).status).toBe(404);
    expect((await t.delete(`${url}/${q.id}`)).status).toBe(200);
    expect((await s.get(`${url}?courseId=${r.course.id}&year=2022`)).body.items).toHaveLength(0);
  });
});
