import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import sharp from 'sharp';
import type { User } from '@prisma/client';
import { prisma } from '../../db';
import { setClock } from '../../lib/clock';
import { invalidateBannedWords } from '../../lib/bannedWords';
import { flushNotifications } from '../../lib/notify';
import { deliverPush, setPushSender, setPushSink } from '../../lib/push';
import { setStorageBackend, createMemoryBackend } from '../../lib/files';
import { captureMail } from '../../../../../test/factories';
import { adminClient, clientFor, fillStudents, makeApp, makeCourse, makeSessionViaApi, makeTeacher, uniq } from '../../../../../test/m3kit';
import { createSocketServer } from '../realtime/socket';
import { revokeAllSessions } from '../auth/sessions';
import { takeQuota } from '../mail/queue';
import { chatMembership } from '../../lib/chatMembership';
import { markRead } from './service';
import { publishDue, publishNotice, resolveAudience } from '../notices/service';

vi.mock('../../jobs', async (orig) => ({
  ...(await orig<typeof import('../../jobs')>()),
  enqueue: vi.fn(async () => {}),
  jobsRunning: () => false,
}));

const app = makeApp();
const mail = captureMail();
type Api = Awaited<ReturnType<typeof clientFor>>;
let admin: Awaited<ReturnType<typeof adminClient>>;
const DAY = 86_400_000;

beforeAll(async () => {
  setStorageBackend(createMemoryBackend());
  admin = await adminClient(prisma, app);
});
afterEach(() => {
  setClock(null);
  mail.clear();
  setPushSink(undefined);
  setPushSender(null);
});
afterAll(() => prisma.$disconnect());

const email = () => `${uniq('u').toLowerCase()}@x.test`;
const api = (u: User): Promise<Api> => clientFor(app, u);

/** One session with two sections (A science, B commerce), each with a mentor and students; everyone is synced into the chats. */
async function world() {
  const tree = await makeSessionViaApi(admin.c);
  const secA = tree.groups.science.sectionId;
  const secB = tree.groups.commerce.sectionId;
  const mentorA = await makeTeacher(prisma);
  const mentorB = await makeTeacher(prisma);
  expect((await admin.c.patch(`/api/academics/sections/${secA}`, { mentorTeacherId: mentorA.id })).status).toBe(200);
  expect((await admin.c.patch(`/api/academics/sections/${secB}`, { mentorTeacherId: mentorB.id })).status).toBe(200);
  const [a1, a2, a3] = await fillStudents(prisma, secA, 3);
  const [b1] = await fillStudents(prisma, secB, 1);
  for (const u of [a1!, a2!, a3!, b1!]) await chatMembership.sync(u.id);
  const convA = (await prisma.conversation.findUniqueOrThrow({ where: { type_refId: { type: 'section', refId: secA } } })).id;
  const groupA = (await prisma.conversation.findUniqueOrThrow({ where: { type_refId: { type: 'group', refId: tree.groups.science.id } } })).id;
  const convB = (await prisma.conversation.findUniqueOrThrow({ where: { type_refId: { type: 'section', refId: secB } } })).id;
  return { tree, secA, secB, mentorA, mentorB, a1: a1!, a2: a2!, a3: a3!, b1: b1!, convA, groupA, convB };
}

const send = (c: Api, conv: string, text: string, extra: object = {}) => c.post(`/api/chat/conversations/${conv}/messages`, { text, ...extra });
const members = (conversationId: string) => prisma.conversationMember.findMany({ where: { conversationId, leftAt: null }, select: { userId: true } }).then((m) => m.map((x) => x.userId));

async function server() {
  const srv = http.createServer(app);
  const io = createSocketServer(srv);
  await new Promise<void>((r) => srv.listen(0, r));
  const port = (srv.address() as AddressInfo).port;
  const open = (cookie: string): Promise<Socket> =>
    new Promise((res, rej) => {
      const s = connect(`http://localhost:${port}`, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false });
      s.on('ready', () => res(s));
      s.on('connect_error', rej);
    });
  const attempt = (cookie: string): Promise<'ok' | 'rejected'> =>
    new Promise((res) => {
      const s = connect(`http://localhost:${port}`, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false });
      s.on('connect', () => (s.close(), res('ok')));
      s.on('connect_error', () => (s.close(), res('rejected')));
    });
  return { open, attempt, close: async () => void (await io.close()) };
}
const once = <T = unknown>(s: Socket, ev: string, ms = 2000): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ${ev}`)), ms);
    s.once(ev, (p: T) => (clearTimeout(t), res(p)));
  });
const silent = (s: Socket, ev: string, ms = 400): Promise<boolean> =>
  new Promise((res) => {
    let got = false;
    s.once(ev, () => (got = true));
    setTimeout(() => res(!got), ms);
  });

describe('messaging (spec 07)', () => {
  it('[CHAT-01] socket rejected without a session; revoked session disconnects; no events after leaving a chat', async () => {
    const w = await world();
    const srv = await server();
    try {
      expect(await srv.attempt('')).toBe('rejected');
      expect(await srv.attempt('cms_session=bogus')).toBe('rejected');
      const stu = await api(w.a1);
      const tch = await api(w.mentorA);
      const s = await srv.open(stu.cookie);
      const incoming = once<{ text: string }>(s, 'msg:new');
      expect((await send(tch, w.convA, 'hello class')).status).toBe(201);
      expect((await incoming).text).toBe('hello class');

      // Moving the student to the other section removes them from the room.
      expect((await admin.c.post('/api/users/students/move', { studentIds: [w.a1.id], targetSectionId: w.secB })).status).toBe(200);
      await new Promise((r) => setTimeout(r, 150));
      const quiet = silent(s, 'msg:new');
      expect((await send(tch, w.convA, 'after you left')).status).toBe(201);
      expect(await quiet).toBe(true);
      expect((await (await api(w.a1)).get(`/api/chat/conversations/${w.convA}/messages`)).status).toBe(200); // history up to leftAt only
      expect((await send(stu, w.convA, 'still here?')).status).toBe(404);

      const closed = new Promise<void>((r) => s.on('disconnect', () => r()));
      await revokeAllSessions(w.a1.id);
      await closed;
      expect(s.connected).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('[CHAT-02] direct chat pair rules: student↔student, teacher↔student, teacher↔teacher, Admin↔anyone', async () => {
    const w = await world();
    const t = await makeTeacher(prisma);
    const pairs: [User | { id: string }, User, Api][] = [
      [w.a2, w.a1, await api(w.a2)],
      [w.mentorA, w.a1, await api(w.mentorA)],
      [w.a1, w.mentorA, await api(w.a1)],
      [t, w.mentorB, await api(t)],
      [{ id: admin.admin.id }, w.a3, admin.c as unknown as Api],
      [w.a3, admin.admin, await api(w.a3)],
      [{ id: admin.admin.id }, t, admin.c as unknown as Api],
    ];
    for (const [, target, c] of pairs) {
      const r = await c.post('/api/chat/direct', { userId: target.id });
      expect([200, 201], `${target.id}: ${JSON.stringify(r.body)}`).toContain(r.status);
    }
    const c1 = await api(w.a2);
    const a = await c1.post('/api/chat/direct', { userId: w.a1.id });
    const b = await (await api(w.a1)).post('/api/chat/direct', { userId: w.a2.id });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id); // one conversation per pair
    expect((await c1.post('/api/chat/direct', { userId: w.a2.id })).status).toBe(400); // not with yourself
    const gone = await makeTeacher(prisma, { status: 'inactive' });
    expect((await c1.post('/api/chat/direct', { userId: gone.id })).status).toBe(404);
    expect((await send(c1, a.body.id as string, 'hi')).status).toBe(201);
    const outsider = await api(w.b1);
    expect((await send(outsider, a.body.id as string, 'snoop')).status).toBe(404);
  });

  it('[CHAT-03] a blocked user cannot start or send direct messages; the blocker no longer sees their group messages', async () => {
    const w = await world();
    const [ca1, ca2, ca3] = [await api(w.a1), await api(w.a2), await api(w.a3)];
    const d = await ca2.post('/api/chat/direct', { userId: w.a1.id });
    expect((await send(ca2, d.body.id as string, 'before block')).status).toBe(201);
    expect((await ca1.post('/api/chat/blocks', { userId: w.a2.id })).status).toBe(201);
    const start = await ca2.post('/api/chat/direct', { userId: w.a1.id });
    expect(start.status).toBe(403);
    expect(start.body.error.code).toBe('BLOCKED');
    const s2 = await send(ca2, d.body.id as string, 'after block');
    expect([s2.status, s2.body.error.code]).toEqual([403, 'BLOCKED']);
    // The blocker cannot message the blocked person either.
    expect((await send(ca1, d.body.id as string, 'hi')).body.error.code).toBe('BLOCKED');

    expect((await send(ca2, w.convA, 'from the blocked one')).status).toBe(201);
    const seenBy = async (c: Api) => ((await c.get(`/api/chat/conversations/${w.convA}/messages`)).body.items as { text: string }[]).map((m) => m.text);
    expect(await seenBy(ca1)).not.toContain('from the blocked one');
    expect(await seenBy(ca3)).toContain('from the blocked one');
    expect((await ca1.delete(`/api/chat/blocks/${w.a2.id}`)).status).toBe(200);
    expect(await seenBy(ca1)).toContain('from the blocked one');
  });

  it('[CHAT-04] a muted user cannot send messages', async () => {
    const w = await world();
    const c = await api(w.a1);
    await prisma.userSanction.create({ data: { userId: w.a1.id, type: 'mute', reason: 'test', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + DAY), createdBy: admin.admin.id } });
    const r = await send(c, w.convA, 'hello');
    expect([r.status, r.body.error.code]).toEqual([403, 'MUTED']);
    expect(await prisma.message.count({ where: { senderId: w.a1.id } })).toBe(0);
  });

  it('[CHAT-05] a banned word returns 422 "This message contains a blocked word." and nothing is stored', async () => {
    const w = await world();
    const word = uniq('zzbad').toLowerCase();
    const before = await prisma.setting.findUnique({ where: { key: 'banned_words_enabled' } });
    await prisma.setting.upsert({ where: { key: 'banned_words_enabled' }, create: { key: 'banned_words_enabled', value: true }, update: { value: true } });
    const bw = await prisma.bannedWord.create({ data: { word, createdBy: admin.admin.id } });
    invalidateBannedWords();
    try {
      const c = await api(w.a1);
      const r = await send(c, w.convA, `this has ${word} inside`);
      expect(r.status).toBe(422);
      expect(r.body.error).toMatchObject({ code: 'BLOCKED_WORD', message: 'This message contains a blocked word.' });
      expect(await prisma.message.count({ where: { conversationId: w.convA } })).toBe(0);
      expect((await send(c, w.convA, 'a clean message')).status).toBe(201);
    } finally {
      await prisma.bannedWord.delete({ where: { id: bw.id } });
      if (before) await prisma.setting.update({ where: { key: 'banned_words_enabled' }, data: { value: before.value as never } });
      else await prisma.setting.delete({ where: { key: 'banned_words_enabled' } });
      invalidateBannedWords();
    }
  });

  it('[CHAT-06] group and section membership syncs on student create, move, pass-out, mentor change and teacher change', async () => {
    const w = await world();
    const inConv = async (conv: string, id: string) => (await members(conv)).includes(id);

    // create
    const created = await admin.c.post('/api/users/students', { name: 'New Kid', roll: uniq('r'), email: email(), sectionId: w.secA });
    expect(created.status).toBe(201);
    const sid = created.body.id as string;
    expect([await inConv(w.convA, sid), await inConv(w.groupA, sid)]).toEqual([true, true]);
    // move to the other group
    expect((await admin.c.post('/api/users/students/move', { studentIds: [sid], targetSectionId: w.secB })).status).toBe(200);
    expect([await inConv(w.convA, sid), await inConv(w.groupA, sid), await inConv(w.convB, sid)]).toEqual([false, false, true]);
    // pass-out
    expect((await admin.c.post('/api/users/students/pass-out', { studentIds: [sid] })).status).toBe(200);
    expect(await inConv(w.convB, sid)).toBe(false);
    // mentor change: the new mentor joins the section and group chats, the old one leaves
    const newMentor = await makeTeacher(prisma);
    expect((await admin.c.patch(`/api/academics/sections/${w.secA}`, { mentorTeacherId: newMentor.id })).status).toBe(200);
    expect([await inConv(w.convA, newMentor.id), await inConv(w.groupA, newMentor.id)]).toEqual([true, true]);
    expect([await inConv(w.convA, w.mentorA.id), await inConv(w.groupA, w.mentorA.id)]).toEqual([false, false]);
    // teacher change: a course teacher joins the section chat only (never the group chat)
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    const t1 = await makeTeacher(prisma);
    const t2 = await makeTeacher(prisma);
    const put = (teacherId: string) => admin.c.put(`/api/academics/sections/${w.secA}/offerings`, { items: [{ courseId: course.id, teacherId }] });
    expect((await put(t1.id)).status).toBe(200);
    expect([await inConv(w.convA, t1.id), await inConv(w.groupA, t1.id)]).toEqual([true, false]);
    expect((await put(t2.id)).status).toBe(200);
    expect([await inConv(w.convA, t1.id), await inConv(w.convA, t2.id)]).toEqual([false, true]);
  });

  it('[CHAT-07] the Admin is not in group/section chats and sees only the reported message with 10 before and 10 after', async () => {
    const w = await world();
    expect(await prisma.conversationMember.count({ where: { userId: admin.admin.id, conversation: { type: { in: ['group', 'section'] } } } })).toBe(0);
    for (const conv of [w.convA, w.groupA]) expect((await admin.c.get(`/api/chat/conversations/${conv}/messages`)).status).toBe(404);
    const [s1, s2] = [await api(w.a1), await api(w.a2)];
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push((await send(i % 2 ? s1 : s2, w.convA, `line ${i}`)).body.id as string);
    const target = ids[12]!;
    expect((await admin.c.get(`/api/admin/moderation/message/${target}/context`)).status).toBe(404); // no report yet
    expect((await s1.post('/api/reports', { targetType: 'message', targetId: target, reason: 'harassment' })).status).toBe(201);
    const ctx = await admin.c.get(`/api/admin/moderation/message/${target}/context`);
    expect(ctx.status).toBe(200);
    expect(ctx.body.target.text).toBe('line 12');
    expect((ctx.body.before as { text: string }[]).map((m) => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `line ${2 + i}`));
    expect((ctx.body.after as { text: string }[]).map((m) => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `line ${13 + i}`));
    expect([403, 404]).toContain((await s2.get(`/api/admin/moderation/message/${target}/context`)).status);
    // an outsider cannot report a message of a chat they are not in; nobody can report their own
    expect((await (await api(w.b1)).post('/api/reports', { targetType: 'message', targetId: target, reason: 'spam' })).status).toBe(404);
    expect((await (await api(w.a1)).post('/api/reports', { targetType: 'message', targetId: ids[1]!, reason: 'spam' })).status).toBe(400);
    // Admin removes the reported message: it shows as deleted for members
    const del = await admin.c.post(`/api/admin/moderation/message/${target}`, { action: 'delete', reason: 'abuse' });
    expect(del.status).toBe(200);
    const hist = (await s1.get(`/api/chat/conversations/${w.convA}/messages?limit=50`)).body.items as { id: string; deleted: boolean; text: string | null }[];
    expect(hist.find((m) => m.id === target)).toMatchObject({ deleted: true, text: null });
  });

  it('[CHAT-08] unread counts and seen status are correct in direct and group chats', async () => {
    const w = await world();
    const [c1, c2, c3] = [await api(w.a1), await api(w.a2), await api(w.a3)];
    const d = (await c1.post('/api/chat/direct', { userId: w.a2.id })).body.id as string;
    const m = [] as string[];
    for (const t of ['one', 'two', 'three']) m.push((await send(c1, d, t)).body.id as string);
    const unread = async (c: Api, conv: string) => ((await c.get('/api/chat/conversations')).body.items as { id: string; unread: number }[]).find((x) => x.id === conv)?.unread;
    expect(await unread(c2, d)).toBe(3);
    expect(await unread(c1, d)).toBe(0); // my own messages never count
    await markRead({ id: w.a2.id, role: 'student' }, d, m[1]!);
    expect(await unread(c2, d)).toBe(1);
    expect(await markRead({ id: w.a2.id, role: 'student' }, d, m[0]!)).toBeNull(); // never goes backwards
    expect(await unread(c2, d)).toBe(1);
    const seen = async (c: Api, conv: string) => ((await c.get(`/api/chat/conversations/${conv}/messages`)).body.items as { id: string; seenBy?: number }[]).map((x) => x.seenBy);
    expect(await seen(c1, d)).toEqual([1, 1, 0]); // "Seen" for the first two
    // group chat: "Seen by N"
    const g1 = (await send(c1, w.convA, 'to the section')).body.id as string;
    await markRead({ id: w.a2.id, role: 'student' }, w.convA, g1);
    await markRead({ id: w.a3.id, role: 'student' }, w.convA, g1);
    expect(await seen(c1, w.convA)).toEqual([2]);
    expect(await seen(c2, w.convA)).toEqual([undefined]); // only the sender sees the count
    expect(await unread(c3, w.convA)).toBe(0);
    // deleting a message hides its text
    expect((await c1.delete(`/api/chat/messages/${g1}`)).status).toBe(200);
    expect((await c2.delete(`/api/chat/messages/${g1}`)).status).toBe(404); // only the sender
  });

  it('[CHAT-13] notifications arrive in real time with the unread count and can be marked read', async () => {
    const w = await world();
    const srv = await server();
    try {
      const stu = await api(w.a1);
      const s = await srv.open(stu.cookie);
      const got = once<{ type: string; unread: number }>(s, 'notif:new');
      const nid = await admin.c.post('/api/notices', { scope: 'central', audience: { all: true }, title: 'Hello all', bodyHtml: '<p>hi</p>' });
      expect(nid.status).toBe(201);
      const n = await got;
      expect(n.type).toBe('notice_new');
      expect(n.unread).toBeGreaterThanOrEqual(1);
      const list = await stu.get('/api/notifications');
      expect(list.body.items.some((x: { type: string; read: boolean }) => x.type === 'notice_new' && !x.read)).toBe(true);
      const count = (await stu.get('/api/notifications/unread-count')).body.unread as number;
      expect(count).toBe(n.unread);
      const first = list.body.items[0].id as string;
      expect((await stu.post('/api/notifications/read', { ids: [first] })).body.unread).toBe(count - 1);
      expect((await stu.post('/api/notifications/read', { all: true })).body.unread).toBe(0);
      expect((await stu.get('/api/notifications/unread-count')).body.unread).toBe(0);
    } finally {
      await srv.close();
    }
  });
});

describe('notices (spec 07 §3)', () => {
  it('[CHAT-09] audiences resolve correctly: central filters by role/session/group; class-wise only for the author’s offerings and sections', async () => {
    const w = await world();
    const students = (ids: string[]) => ids.filter((i) => [w.a1.id, w.a2.id, w.a3.id, w.b1.id].includes(i)).sort();
    const sci = w.tree.groups.science.id;
    const science = await resolveAudience('central', { sessionIds: [w.tree.sessionId], groupIds: [sci], roles: ['student'] });
    expect(students(science)).toEqual([w.a1.id, w.a2.id, w.a3.id].sort());
    expect(science).not.toContain(w.mentorA.id); // roles: student only
    const teachers = await resolveAudience('central', { sessionIds: [w.tree.sessionId], roles: ['teacher'] });
    expect(teachers).toEqual(expect.arrayContaining([w.mentorA.id, w.mentorB.id]));
    expect(students(teachers)).toEqual([]);
    const both = await resolveAudience('central', { groupIds: [sci] });
    expect(both).toEqual(expect.arrayContaining([w.a1.id, w.mentorA.id]));
    expect(both).not.toContain(w.b1.id);
    expect(both).not.toContain(w.mentorB.id);
    expect(await resolveAudience('central', { all: true })).toEqual(expect.arrayContaining([w.a1.id, w.b1.id, w.mentorA.id]));

    // class-wise: through the API, as teachers
    const course = await makeCourse(prisma, { groupType: 'science', classLevel: 'c11' });
    const teacher = await makeTeacher(prisma);
    expect((await admin.c.put(`/api/academics/sections/${w.secA}/offerings`, { items: [{ courseId: course.id, teacherId: teacher.id }] })).status).toBe(200);
    const offering = await prisma.courseOffering.findFirstOrThrow({ where: { sectionId: w.secA, courseId: course.id } });
    const tc = await api(teacher);
    const other = await api(await makeTeacher(prisma));
    const body = { scope: 'class', title: 'Quiz tomorrow', bodyHtml: '<p>Bring a pen</p>' };
    expect((await tc.post('/api/notices', { ...body, audience: { offeringIds: [offering.id] } })).status).toBe(201);
    expect((await other.post('/api/notices', { ...body, audience: { offeringIds: [offering.id] } })).status).toBe(403);
    expect((await tc.post('/api/notices', { ...body, audience: { sectionIds: [w.secB] } })).status).toBe(403);
    expect((await tc.post('/api/notices', { ...body, scope: 'central', audience: { all: true } })).status).toBe(403);
    expect((await (await api(w.a1)).post('/api/notices', { ...body, audience: { offeringIds: [offering.id] } })).status).toBe(403);
    expect((await (await api(w.mentorB)).post('/api/notices', { ...body, audience: { sectionIds: [w.secA] } })).status).toBe(403);
    expect((await (await api(w.mentorA)).post('/api/notices', { ...body, audience: { sectionIds: [w.secA] } })).status).toBe(201); // the mentor's own section
    const recips = await prisma.noticeRecipient.findMany({ where: { notice: { authorId: teacher.id } }, select: { userId: true } });
    expect(recips.map((r) => r.userId).sort()).toEqual([w.a1.id, w.a2.id, w.a3.id, teacher.id].sort());
    expect((await admin.c.post('/api/notices', { ...body, audience: { sectionIds: [w.secA] } })).status).toBe(403); // class-wise is for teachers
  });

  it('[CHAT-10] a scheduled notice publishes once at publishAt; expired notices are hidden', async () => {
    const w = await world();
    const stu = await api(w.a1);
    const at = new Date(Date.now() + 2 * DAY);
    const r = await admin.c.post('/api/notices', { scope: 'central', audience: { sessionIds: [w.tree.sessionId] }, title: 'Later', bodyHtml: '<p>soon</p>', publishAt: at.toISOString(), expiresAt: new Date(at.getTime() + DAY).toISOString() });
    expect(r.status).toBe(201);
    expect(r.body.published).toBe(false);
    const titles = async () => ((await stu.get('/api/notices')).body.items as { title: string }[]).map((n) => n.title);
    expect(await titles()).not.toContain('Later');
    expect(await publishDue()).toBeGreaterThanOrEqual(0);
    expect(await prisma.noticeRecipient.count({ where: { noticeId: r.body.id } })).toBe(0); // not yet
    setClock(() => new Date(at.getTime() + 1000));
    expect(await publishNotice(r.body.id as string)).toBeGreaterThan(0);
    expect(await publishNotice(r.body.id as string)).toBeNull(); // second run does nothing
    await publishDue();
    expect(await prisma.notification.count({ where: { userId: w.a1.id, type: 'notice_new', refId: r.body.id } })).toBe(1);
    expect(await titles()).toContain('Later');
    setClock(() => new Date(at.getTime() + 2 * DAY));
    expect(await titles()).not.toContain('Later'); // expired
    expect((await stu.get('/api/notices/urgent-unread')).body.items).toEqual([]);
  });

  it('[CHAT-12] urgent notice email ignores the email preference; important/urgent notices email, normal ones do not', async () => {
    const w = await world();
    const keep = await api(w.a1);
    const optOut = await api(w.a2);
    expect((await optOut.put('/api/me/notification-prefs', { prefs: [{ type: 'notice_new', email: false, push: true }] })).status).toBe(200);
    const aud = { sessionIds: [w.tree.sessionId], roles: ['student'] };
    const post = async (priority: string) => {
      mail.clear();
      const r = await admin.c.post('/api/notices', { scope: 'central', audience: aud, title: `Notice ${priority}`, bodyHtml: '<p>text</p>', priority });
      expect(r.status).toBe(201);
      await flushNotifications();
      return mail.sent.map((s) => s.m.to);
    };
    const normal = await post('normal');
    expect(normal).not.toContain(w.a1.email);
    const important = await post('important');
    expect(important).toContain(w.a1.email);
    expect(important).not.toContain(w.a2.email); // opted out, important respects the choice
    const urgent = await post('urgent');
    expect(urgent).toEqual(expect.arrayContaining([w.a1.email, w.a2.email])); // urgent cannot be turned off
    expect((await keep.get('/api/notices/urgent-unread')).body.items.length).toBeGreaterThan(0);
    expect(mail.sent.every((s) => s.priority === 'normal')).toBe(true);
  });

  it('[CHAT-16-api] notices list filters Central / class, unread, urgent banner clears when read', async () => {
    const w = await world();
    const stu = await api(w.a1);
    const u = await admin.c.post('/api/notices', { scope: 'central', audience: { sessionIds: [w.tree.sessionId] }, title: 'Urgent one', bodyHtml: '<p>x</p>', priority: 'urgent' });
    const banner = async () => ((await stu.get('/api/notices/urgent-unread')).body.items as { id: string }[]).map((n) => n.id);
    expect(await banner()).toContain(u.body.id);
    expect(((await stu.get('/api/notices?filter=class')).body.items as { id: string }[]).map((n) => n.id)).not.toContain(u.body.id);
    expect(((await stu.get('/api/notices?filter=central&unread=true')).body.items as { id: string }[]).map((n) => n.id)).toContain(u.body.id);
    expect((await stu.post(`/api/notices/${u.body.id}/read`)).status).toBe(200);
    expect(await banner()).not.toContain(u.body.id);
    expect(((await stu.get('/api/notices?filter=central&unread=true')).body.items as { id: string }[]).map((n) => n.id)).not.toContain(u.body.id);
    expect((await (await api(w.b1)).post(`/api/notices/${u.body.id}/read`)).status).toBe(200); // b1 is in the same session
    // landing page: only central notices flagged for it, public attachments
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    const pub = await admin.c.req('post', '/api/notices').field('scope', 'central').field('audience', JSON.stringify({ all: true })).field('title', 'Open day').field('bodyHtml', '<p onclick="x()">Welcome<script>alert(1)</script></p>').field('showOnLanding', 'true').attach('attachments', png, 'a.png');
    expect(pub.status).toBe(201);
    const landing = await (await import('supertest')).default(app).get('/api/public/notices');
    const item = (landing.body.items as { id: string; title: string; bodyHtml: string; attachments: { url: string }[] }[]).find((n) => n.title === 'Open day');
    expect(item?.bodyHtml).toBe('<p>Welcome</p>');
    expect(item?.attachments[0]?.url).toContain('/public/');
    const priv = await admin.c.req('post', '/api/notices').field('scope', 'central').field('audience', JSON.stringify({ all: true })).field('title', 'Internal').field('bodyHtml', '<p>x</p>').attach('attachments', png, 'a.png');
    expect(priv.status).toBe(201);
    const row = await prisma.notice.findUniqueOrThrow({ where: { id: priv.body.id as string }, include: { attachments: { include: { file: true } } } });
    expect(row.attachments[0]?.file.bucket).toBe('private');
    expect(((await (await import('supertest')).default(app).get('/api/public/notices')).body.items as { title: string }[]).map((n) => n.title)).not.toContain('Internal');
  });
});

describe('email quota and push (spec 07 §5-6)', () => {
  it('[CHAT-11] emails over the daily limit wait until the next day; reset and verification emails go first', async () => {
    const before = await prisma.setting.findUnique({ where: { key: 'email_daily_limit' } });
    await prisma.setting.upsert({ where: { key: 'email_daily_limit' }, create: { key: 'email_daily_limit', value: 10 }, update: { value: 10 } });
    try {
      const day = new Date('2090-03-04T06:00:00Z');
      const normal = [];
      for (let i = 0; i < 10; i++) normal.push(await takeQuota('normal', day));
      expect(normal.filter(Boolean).length).toBe(9); // normal mail stops at 90 %
      expect(await takeQuota('high', day)).toBe(true); // the reserved 10 % is for high priority
      expect(await takeQuota('high', day)).toBe(false);
      expect(await takeQuota('normal', new Date(day.getTime() + DAY))).toBe(true); // next day resets
    } finally {
      if (before) await prisma.setting.update({ where: { key: 'email_daily_limit' }, data: { value: before.value as never } });
      else await prisma.setting.delete({ where: { key: 'email_daily_limit' } });
    }
    // The queue gives high priority a higher pg-boss priority and re-schedules over-limit mail for 00:05 Dhaka.
    const { queueEmail, setEmailSink } = await import('../mail/queue');
    const jobs = await import('../../jobs');
    setEmailSink(undefined);
    try {
      await queueEmail({ to: 'a@x.test', subject: 's', text: 't' }, 'high');
      await queueEmail({ to: 'a@x.test', subject: 's', text: 't' }, 'normal');
      const calls = vi.mocked(jobs.enqueue).mock.calls.slice(-2);
      expect(calls.map((c) => c[2]?.priority)).toEqual([10, 0]);
    } finally {
      captureMail();
    }
  });

  it('[CHAT-14] push payloads never contain message or post text; a 404/410 from the push service deletes the subscription', async () => {
    const w = await world();
    const sent: { endpoint: string; payload: Record<string, string> }[] = [];
    let failWith: number | null = null;
    setPushSender(async (t, p) => {
      if (failWith) throw Object.assign(new Error('gone'), { statusCode: failWith });
      sent.push({ endpoint: t.endpoint, payload: JSON.parse(p) as Record<string, string> });
    });
    setPushSink(async (uid, p) => void (await deliverPush(uid, p)));
    const stu = await api(w.a2);
    const ep = `https://push.example/${uniq('ep')}`;
    expect((await stu.post('/api/me/push-subscriptions', { endpoint: ep, keys: { p256dh: 'k', auth: 'a' } })).status).toBe(201);
    const secret = 'my secret exam answer 42';
    expect((await send(await api(w.a1), w.convA, secret)).status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    await flushNotifications();
    expect(sent.length).toBe(1);
    expect(JSON.stringify(sent[0]!.payload)).not.toContain('secret');
    expect(sent[0]!.payload.body).toMatch(/^New message from /);
    expect(sent[0]!.payload.url).toBe(`/messages/${w.convA}`);
    expect(Object.keys(sent[0]!.payload).sort()).toEqual(['body', 'title', 'url']);

    // push preference off → nothing more is sent
    await stu.put('/api/me/notification-prefs', { prefs: [{ type: 'notice_new', email: true, push: false }] });
    await admin.c.post('/api/notices', { scope: 'central', audience: { sessionIds: [w.tree.sessionId] }, title: 'Quiet', bodyHtml: '<p>b</p>' });
    await flushNotifications();
    expect(sent.length).toBe(1);

    for (const code of [404, 410]) {
      const e = `https://push.example/${uniq('gone')}`;
      await prisma.pushSubscription.create({ data: { userId: w.a3.id, endpoint: e, p256dh: 'k', auth: 'a' } });
      failWith = code;
      await deliverPush(w.a3.id, { title: 'College', body: 'x', url: '/' });
      expect(await prisma.pushSubscription.count({ where: { endpoint: e } })).toBe(0);
    }
    failWith = 500; // other errors keep the subscription
    const keep = `https://push.example/${uniq('keep')}`;
    await prisma.pushSubscription.create({ data: { userId: w.a3.id, endpoint: keep, p256dh: 'k', auth: 'a' } });
    await deliverPush(w.a3.id, { title: 'College', body: 'x', url: '/' });
    expect(await prisma.pushSubscription.count({ where: { endpoint: keep } })).toBe(1);
    expect((await stu.delete('/api/me/push-subscriptions', { endpoint: ep })).status).toBe(200);
    expect(await prisma.pushSubscription.count({ where: { endpoint: ep } })).toBe(0);
  });
});
