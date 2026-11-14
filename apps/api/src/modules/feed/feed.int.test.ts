import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { User } from '@prisma/client';
import { prisma } from '../../db';
import { setClock } from '../../lib/clock';
import { formatLine } from '../../lib/authorLine';
import { compileBanned, matchBanned } from '../../lib/bannedWords';
import { adminClient, clientFor, fillStudents, makeApp, makeSessionViaApi, makeTeacher, uniq } from '../../../../../test/m3kit';
import { purgeRemovedContent } from './moderation';

const app = makeApp();
type Api = Awaited<ReturnType<typeof clientFor>>;
let admin: Awaited<ReturnType<typeof adminClient>>;
const DAY = 86_400_000;

beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterEach(() => setClock(null));
afterAll(() => prisma.$disconnect());

/** A session with two sections (science and commerce), each with a mentor and two students. */
async function world() {
  const tree = await makeSessionViaApi(admin.c);
  const secA = tree.groups.science.sectionId;
  const secB = tree.groups.commerce.sectionId;
  const mentorA = await makeTeacher(prisma);
  const mentorB = await makeTeacher(prisma);
  await prisma.section.update({ where: { id: secA }, data: { mentorTeacherId: mentorA.id } });
  await prisma.section.update({ where: { id: secB }, data: { mentorTeacherId: mentorB.id } });
  const [a1, a2] = await fillStudents(prisma, secA, 2);
  const [b1] = await fillStudents(prisma, secB, 1);
  const plain = await makeTeacher(prisma);
  const c = async (u: User): Promise<Api> => clientFor(app, u);
  return {
    secA, secB, mentorA, mentorB, a1: a1!, a2: a2!, b1: b1!, plain,
    mA: await c(mentorA), mB: await c(mentorB), sA1: await c(a1!), sA2: await c(a2!), sB1: await c(b1!), tPlain: await c(plain),
  };
}

const post = async (c: Api, text: string, extra: Record<string, string> = {}) => {
  const r = c.req('post', '/api/feed/posts');
  r.field('text', `${text} ${uniq('t')}`);
  for (const [k, v] of Object.entries(extra)) r.field(k, v);
  return r;
};
const mk = async (c: Api, text: string, extra: Record<string, string> = {}): Promise<string> => {
  const r = await post(c, text, extra);
  if (r.status !== 201) throw new Error(`post ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
};
const feed = async (c: Api) => (await c.get('/api/feed')).body as { pinned: { id: string }[]; items: { id: string }[]; nextCursor: string | null };
const ids = (l: { id: string }[]) => l.map((x) => x.id);
const only = (l: string[], keep: string[]) => l.filter((x) => keep.includes(x));
const notes = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type } });
const png = (w = 20) => sharp({ create: { width: w, height: w, channels: 3, background: { r: 200, g: 10, b: 10 } } }).png().toBuffer();

describe('community feed (spec 06)', () => {
  it('[COMM-01] feed order: unseen Admin pins → unseen mentor pins (own section only) → everything else, newest first', async () => {
    const w = await world();
    const p1 = await mk(w.sA1, 'plain student post');
    const m1 = await mk(w.mA, 'mentor A announcement', { pin: 'true' });
    const a1 = await mk(admin.c as unknown as Api, 'admin announcement', { pin: 'true' });
    const mB = await mk(w.mB, 'mentor B announcement', { pin: 'true' });
    const a2 = await mk(admin.c as unknown as Api, 'admin announcement 2', { pin: 'true' });
    const p2 = await mk(w.tPlain, 'teacher post');
    const mine = [p1, m1, a1, mB, a2, p2];

    const fa = await feed(w.sA2);
    expect(only(ids(fa.pinned), mine)).toEqual([a2, a1, m1]); // admin pins newest first, then the mentor pin
    expect(only(ids(fa.items), mine)).toEqual([p2, mB, p1]); // pinned ones are not repeated; another section's mentor pin is a normal post
    const fb = await feed(w.sB1);
    expect(only(ids(fb.pinned), mine)).toEqual([a2, a1, mB]);
    expect(only(ids(fb.items), mine)).toEqual([p2, m1, p1]); // another section's mentor pin is only a normal post
    const ft = await feed(w.tPlain);
    expect(only(ids(ft.pinned), mine)).toEqual([a2, a1]);
    expect(only(ids(ft.items), mine)).toEqual([p2, mB, m1, p1]);
  });

  it('[COMM-02] a seen pin leaves the top on the next load (not instantly); one PostView covers feed and dashboard', async () => {
    const w = await world();
    const a = await mk(admin.c as unknown as Api, 'seen test', { pin: 'true' });
    expect(ids((await feed(w.sA1)).pinned)).toContain(a);
    expect((await w.sA1.post('/api/feed/seen', { postIds: [a] })).status).toBe(200);
    expect((await w.sA1.post(`/api/feed/posts/${a}/seen`)).status).toBe(200); // idempotent
    expect(await prisma.postView.count({ where: { postId: a, userId: w.a1.id } })).toBe(1);
    const next = await feed(w.sA1);
    expect(ids(next.pinned)).not.toContain(a);
    expect(ids(next.items)).toContain(a); // back in the timeline at its original date
    const dash = (await w.sA1.get('/api/feed/pinned')).body as { items: { id: string }[] };
    expect(ids(dash.items)).not.toContain(a);
    // Other users still see it on top.
    expect(ids((await feed(w.sA2)).pinned)).toContain(a);
    // Unknown or held ids are ignored, not errors.
    expect((await w.sA1.post('/api/feed/seen', { postIds: ['c' + 'x'.repeat(24)] })).status).toBe(200);
  });

  it('[COMM-03] a pin older than 7 days is never on top and the post stays in the timeline; no pins → regular posts first', async () => {
    const w = await world();
    const t0 = Date.now();
    setClock(() => new Date(t0));
    const a = await mk(admin.c as unknown as Api, 'will expire', { pin: 'true' });
    setClock(() => new Date(t0 + 6 * DAY));
    expect(ids((await feed(w.sB1)).pinned)).toContain(a);
    setClock(() => new Date(t0 + 7 * DAY + 1000));
    const f = await feed(w.sB1);
    expect(ids(f.pinned)).not.toContain(a);
    expect(ids(f.items)).toContain(a);
    // A fresh user with nothing unseen and pinned: the feed starts with a regular post.
    setClock(() => new Date(t0 + 30 * DAY));
    const regular = await mk(w.sB1, 'later regular post');
    const f2 = await feed(w.sB1);
    expect(f2.pinned.filter((p) => p.id === a)).toHaveLength(0);
    expect(f2.items[0]!.id).toBe(regular);
  });

  it('[COMM-04] extending a pin helps only users who have not seen it; editing a post does not reset the timer or re-pin it', async () => {
    const w = await world();
    const t0 = Date.now();
    setClock(() => new Date(t0));
    const a = await mk(admin.c as unknown as Api, 'extend me', { pin: 'true' });
    await w.sA1.post(`/api/feed/posts/${a}/seen`);
    setClock(() => new Date(t0 + 8 * DAY));
    expect(ids((await feed(w.sA2)).pinned)).not.toContain(a);
    expect((await admin.c.post(`/api/feed/posts/${a}/extend`, { days: 3 })).status).toBe(200);
    expect(ids((await feed(w.sA2)).pinned)).toContain(a); // unseen: back on top
    expect(ids((await feed(w.sA1)).pinned)).not.toContain(a); // seen: stays down
    expect((await w.sA2.post(`/api/feed/posts/${a}/extend`, { days: 3 })).status).toBe(403); // mentors/students cannot extend

    // Editing: the timer and pin stay exactly as they were.
    const mentorPost = await mk(w.mA, 'mentor pin to edit', { pin: 'true' });
    const before = await prisma.post.findUniqueOrThrow({ where: { id: mentorPost } });
    setClock(() => new Date(t0 + 9 * DAY));
    const edit = await w.mA.req('patch', `/api/feed/posts/${mentorPost}`).field('text', 'edited text').field('pin', 'true');
    expect(edit.status).toBe(200);
    const after = await prisma.post.findUniqueOrThrow({ where: { id: mentorPost } });
    expect(after.pinnedUntil).toEqual(before.pinnedUntil);
    expect(after.editedAt).not.toBeNull();
    // An unpinned post cannot be pinned by editing.
    const normal = await mk(w.mA, 'normal post');
    await w.mA.req('patch', `/api/feed/posts/${normal}`).field('text', 'edited').field('pin', 'true').field('pinnedUntil', new Date(t0 + 30 * DAY).toISOString());
    expect((await prisma.post.findUniqueOrThrow({ where: { id: normal } })).pinnedUntil).toBeNull();
    // Admin can unpin early.
    expect((await admin.c.post(`/api/feed/posts/${a}/unpin`)).status).toBe(200);
    expect(ids((await feed(w.sA2)).pinned)).not.toContain(a);
  });

  it('[COMM-05] section pins appear on top only for that section; a mentor change keeps the old pin\'s audience', async () => {
    const w = await world();
    const m = await mk(w.mA, 'section pin', { pin: 'true' });
    const row = await prisma.post.findUniqueOrThrow({ where: { id: m } });
    expect(row.pinAudience).toBe('section');
    expect(row.pinSectionId).toBe(w.secA);
    expect(ids((await feed(w.sA1)).pinned)).toContain(m);
    expect(ids((await feed(w.sB1)).pinned)).not.toContain(m);
    expect(ids((await feed(w.tPlain)).pinned)).not.toContain(m);
    // New mentor for section A: the old pin stays for section A's students.
    await prisma.section.update({ where: { id: w.secA }, data: { mentorTeacherId: null } });
    const newMentor = await makeTeacher(prisma);
    await prisma.section.update({ where: { id: w.secA }, data: { mentorTeacherId: newMentor.id } });
    expect(ids((await feed(w.sA2)).pinned)).toContain(m);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: m } })).pinSectionId).toBe(w.secA);
    // The old mentor can no longer pin.
    expect((await post(w.mA, 'late pin', { pin: 'true' })).status).toBe(400);
  });

  it('[COMM-06] non-mentor teachers and students cannot pin; the pin can be chosen only at creation', async () => {
    const w = await world();
    expect((await post(w.sA1, 'student pin', { pin: 'true' })).status).toBe(400);
    expect((await post(w.tPlain, 'teacher pin', { pin: 'true' })).status).toBe(400);
    expect((await post(w.sA1, 'student no pin', { pin: 'false' })).status).toBe(201);
    expect((await post(w.mA, 'mentor pin', { pin: 'true' })).status).toBe(201);
    expect((await post(w.mA, 'mentor no pin', { pin: 'false' })).status).toBe(201);
    const id = await mk(w.sA1, 'later edit');
    expect((await w.sA1.post(`/api/feed/posts/${id}/extend`, { days: 2 })).status).toBe(403);
    expect((await w.sA1.post(`/api/feed/posts/${id}/unpin`)).status).toBe(403);
  });

  it('[COMM-07] replies are one level only; one reaction per user per post/comment, changeable and removable', async () => {
    const w = await world();
    const p = await mk(w.sA1, 'discuss');
    const top = (await w.sA2.post(`/api/feed/posts/${p}/comments`, { text: 'top' })).body as { id: string };
    const reply = await w.sA1.post(`/api/feed/posts/${p}/comments`, { text: 'reply', parentCommentId: top.id });
    expect(reply.status).toBe(201);
    const deep = await w.sB1.post(`/api/feed/posts/${p}/comments`, { text: 'nested', parentCommentId: reply.body.id });
    expect(deep.status).toBe(400);
    const other = await mk(w.sA1, 'other post');
    expect((await w.sB1.post(`/api/feed/posts/${other}/comments`, { text: 'x', parentCommentId: top.id })).status).toBe(400);

    const list = (await w.sB1.get(`/api/feed/posts/${p}/comments`)).body as { items: { id: string; replies: { id: string }[]; replyCount: number }[] };
    expect(list.items.find((c) => c.id === top.id)?.replies.map((r) => r.id)).toEqual([reply.body.id]);
    expect((await w.sB1.get(`/api/feed/posts/${p}`)).body.commentCount).toBe(2);

    expect((await w.sB1.put(`/api/feed/posts/${p}/reaction`, { type: 'like' })).status).toBe(200);
    expect((await w.sB1.put(`/api/feed/posts/${p}/reaction`, { type: 'love' })).status).toBe(200);
    expect(await prisma.reaction.count({ where: { postId: p, userId: w.b1.id } })).toBe(1);
    const single = (await w.sB1.get(`/api/feed/posts/${p}`)).body as { reactionCounts: Record<string, number>; myReaction: string };
    expect(single.reactionCounts).toEqual({ love: 1 });
    expect(single.myReaction).toBe('love');
    expect((await w.sB1.delete(`/api/feed/posts/${p}/reaction`)).status).toBe(200);
    expect(await prisma.reaction.count({ where: { postId: p, userId: w.b1.id } })).toBe(0);
    expect((await w.sB1.put(`/api/feed/posts/${p}/reaction`, { type: 'bogus' })).status).toBe(400);
    expect((await w.sB1.put(`/api/feed/comments/${top.id}/reaction`, { type: 'haha' })).status).toBe(200);
    expect((await w.sB1.put(`/api/feed/comments/${top.id}/reaction`, { type: 'sad' })).status).toBe(200);
    expect(await prisma.reaction.count({ where: { commentId: top.id, userId: w.b1.id } })).toBe(1);
    expect((await w.sB1.delete(`/api/feed/comments/${top.id}/reaction`)).status).toBe(200);
    // Author is told once per 10 minutes at most.
    await w.sB1.put(`/api/feed/posts/${p}/reaction`, { type: 'like' });
    await w.sA2.put(`/api/feed/posts/${p}/reaction`, { type: 'like' });
    expect(await notes(w.a1.id, 'reaction')).toHaveLength(1);
  });

  it('[COMM-08] a muted user cannot post or comment but can still read', async () => {
    const w = await world();
    const p = await mk(w.sA2, 'readable');
    const target = await mk(w.sA1, 'by soon-muted');
    const m = await admin.c.post(`/api/admin/moderation/post/${target}`, { action: 'mute', days: 2, reason: 'spam' });
    expect(m.status).toBe(200);
    const blocked = await post(w.sA1, 'muted post');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MUTED');
    expect(typeof blocked.body.error.fields.endsAt).toBe('string');
    expect((await w.sA1.post(`/api/feed/posts/${p}/comments`, { text: 'hi' })).body.error.code).toBe('MUTED');
    expect((await w.sA1.get('/api/feed')).status).toBe(200);
    expect((await w.sA1.get(`/api/feed/posts/${p}`)).status).toBe(200);
    // Mute ends by itself.
    setClock(() => new Date(Date.now() + 3 * DAY));
    expect((await post(w.sA1, 'after mute')).status).toBe(201);
    setClock(null);
    // The Admin can end a mute early.
    await admin.c.post(`/api/admin/moderation/post/${target}`, { action: 'mute', days: 5, reason: 'again' });
    expect((await post(w.sA1, 'still muted')).status).toBe(403);
    const list = (await admin.c.get('/api/admin/sanctions')).body as { items: { id: string; user: { id: string } }[] };
    const mine = list.items.filter((x) => x.user.id === w.a1.id);
    expect(mine).toHaveLength(2); // the 2-day mute is still running too
    for (const s of mine) expect((await admin.c.post(`/api/admin/sanctions/${s.id}/lift`)).status).toBe(200);
    expect((await post(w.sA1, 'after lift')).status).toBe(201);
  });

  it('[COMM-09] a post or comment with a banned word is held and visible only to its author and the Admin', async () => {
    const w = await world();
    const bad = `zzbad${uniq('w').toLowerCase()}`;
    expect((await admin.c.post('/api/admin/banned-words', { word: bad })).status).toBe(201);
    expect((await admin.c.post('/api/admin/banned-words', { word: 'বোকা' })).status).toBe(201);
    expect((await admin.c.put('/api/admin/banned-words-enabled', { enabled: true })).status).toBe(200);
    try {
      const held = await post(w.sA1, `this has ${bad.toUpperCase()} inside`);
      expect(held.status).toBe(201);
      expect(held.body.status).toBe('held');
      const hid = held.body.id as string;
      expect(ids((await feed(w.sA1)).items)).toContain(hid); // author sees it ("Waiting for review")
      expect(ids((await feed(w.sA2)).items)).not.toContain(hid);
      expect((await w.sA2.get(`/api/feed/posts/${hid}`)).status).toBe(404);
      expect((await w.sA1.get(`/api/feed/posts/${hid}`)).status).toBe(200);
      expect((await admin.c.get(`/api/feed/posts/${hid}`)).status).toBe(200);
      const q = (await admin.c.get('/api/admin/moderation?type=held')).body as { items: { targetId: string; kind: string }[] };
      expect(q.items.some((i) => i.targetId === hid && i.kind === 'held')).toBe(true);
      // Whole words only, Bangla included.
      expect((await post(w.sA2, `x${bad}y is fine`)).body.status).toBe('published');
      expect((await post(w.sA2, 'তুমি বোকা')).body.status).toBe('held');
      expect((await post(w.sA2, 'বোকামি')).body.status).toBe('published');
      // A held comment is hidden from others too.
      const ok = await mk(w.sA2, 'clean post');
      const hc = await w.sA1.post(`/api/feed/posts/${ok}/comments`, { text: `me ${bad}` });
      expect(hc.body.status).toBe('held');
      const seenByOther = (await w.sB1.get(`/api/feed/posts/${ok}/comments`)).body.items as { id: string }[];
      expect(ids(seenByOther)).not.toContain(hc.body.id);
      expect(ids((await w.sA1.get(`/api/feed/posts/${ok}/comments`)).body.items)).toContain(hc.body.id);
      // Approve publishes it.
      expect((await admin.c.post(`/api/admin/moderation/post/${hid}`, { action: 'approve', reason: 'ok' })).status).toBe(200);
      expect(ids((await feed(w.sA2)).items)).toContain(hid);
    } finally {
      await admin.c.put('/api/admin/banned-words-enabled', { enabled: false });
    }
  });

  it('[COMM-10] the public profile never shows private fields; inactive users show only photo, name and the note; deleted users give 404', async () => {
    const w = await world();
    await prisma.studentProfile.update({
      where: { userId: w.a2.id },
      data: { bio: 'Hello', address: 'SECRET-ADDRESS', guardianName: 'SECRET-GUARDIAN', guardianContact: '01711111111', dob: new Date('2008-01-01') },
    });
    await prisma.user.update({ where: { id: w.a2.id }, data: { mobile: '01822222222' } });
    const r = await w.sB1.get(`/api/users/${w.a2.id}/public`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['avatarUrl', 'bio', 'classLevel', 'group', 'id', 'line', 'name', 'role', 'section', 'session'].sort());
    const text = JSON.stringify(r.body);
    for (const secret of [w.a2.loginId!, w.a2.email!, 'SECRET-ADDRESS', 'SECRET-GUARDIAN', '01711111111', '01822222222', '2008']) expect(text).not.toContain(secret);
    const t = await w.sA1.get(`/api/users/${w.mentorA.id}/public`);
    expect(Object.keys(t.body).sort()).toEqual(['avatarUrl', 'bio', 'coursesTaught', 'id', 'line', 'mentorOf', 'name', 'role'].sort());
    expect(JSON.stringify(t.body)).not.toContain(w.mentorA.loginId!);

    await prisma.user.update({ where: { id: w.a1.id }, data: { status: 'passed_out' } });
    const old = await w.sB1.get(`/api/users/${w.a1.id}/public`);
    expect(old.body).toEqual({ id: w.a1.id, name: 'Filler 0', avatarUrl: null, inactiveNote: 'This account is no longer active.' });
    expect((await w.sB1.get(`/api/feed/users/${w.a1.id}/posts`)).status).toBe(404);
    await prisma.user.update({ where: { id: w.b1.id }, data: { status: 'deleted' } });
    expect((await w.sA2.get(`/api/users/${w.b1.id}/public`)).status).toBe(404);
    expect((await w.sA2.get(`/api/users/${'c' + 'z'.repeat(24)}/public`)).status).toBe(404);
  });

  it('[COMM-11] moderation actions dismiss / delete / delete & warn / mute work, notify the author, soft-delete for 30 days and are audited', async () => {
    const w = await world();
    const p1 = await mk(w.sA1, 'to dismiss');
    const p2 = await mk(w.sA1, 'to delete');
    const p3 = await mk(w.sA1, 'to delete and warn');
    for (const [c, target] of [[w.sA2, p1], [w.sB1, p1], [w.sA2, p2], [w.sA2, p3]] as const) {
      expect((await c.post('/api/reports', { targetType: 'post', targetId: target, reason: 'spam' })).status).toBe(201);
    }
    expect((await w.sA2.post('/api/reports', { targetType: 'post', targetId: p1, reason: 'spam' })).status).toBe(409); // one per reporter
    expect((await w.sA2.post('/api/reports', { targetType: 'post', targetId: p1, reason: 'nonsense' })).status).toBe(400);
    expect((await w.sA2.get('/api/admin/moderation')).status).toBeGreaterThanOrEqual(403);
    const queue = (await admin.c.get('/api/admin/moderation')).body as { items: { targetId: string; reporterCount: number; reasons: string[]; author: { id: string } }[] };
    const q1 = queue.items.find((i) => i.targetId === p1)!;
    expect(q1.reporterCount).toBe(2);
    expect(q1.author.id).toBe(w.a1.id);

    const act = (id: string, body: object) => admin.c.post(`/api/admin/moderation/post/${id}`, body);
    expect((await act(p1, { action: 'dismiss', reason: 'fine' })).status).toBe(200);
    expect((await prisma.report.findMany({ where: { targetId: p1 } })).every((r) => r.status === 'dismissed')).toBe(true);
    expect(ids((await feed(w.sA2)).items)).toContain(p1);

    expect((await act(p2, { action: 'delete', reason: 'rude' })).status).toBe(200);
    const removed = await prisma.post.findUniqueOrThrow({ where: { id: p2 } });
    expect(removed.status).toBe('removed');
    expect(removed.removedAt).not.toBeNull();
    expect(removed.removedBy).toBe(admin.admin.id);
    expect(ids((await feed(w.sA2)).items)).not.toContain(p2);
    expect((await w.sA2.get(`/api/feed/posts/${p2}`)).status).toBe(404);
    expect((await prisma.report.findMany({ where: { targetId: p2 } })).every((r) => r.status === 'actioned')).toBe(true);
    expect(await notes(w.a1.id, 'content_removed')).toHaveLength(1);

    expect((await act(p3, { action: 'delete_warn', reason: 'again' })).status).toBe(200);
    expect(await prisma.userSanction.count({ where: { userId: w.a1.id, type: 'warn' } })).toBe(1);
    expect(await notes(w.a1.id, 'warning')).toHaveLength(1);

    expect((await act(p1, { action: 'mute', days: 3, reason: 'spam' })).status).toBe(200);
    expect(await notes(w.a1.id, 'muted')).toHaveLength(1);
    expect(await prisma.userSanction.count({ where: { userId: w.a1.id, type: 'mute' } })).toBe(1);
    expect((await act(p1, { action: 'mute', reason: 'no days' })).status).toBe(400);

    const logs = await prisma.auditLog.findMany({ where: { targetId: { in: [p1, p2, p3] }, actorId: admin.admin.id } });
    expect(logs.map((l) => l.action).sort()).toEqual(expect.arrayContaining(['moderation.dismiss', 'moderation.delete', 'moderation.delete_warn', 'moderation.mute']));

    // Kept for 30 days, then the nightly job removes it for good.
    await purgeRemovedContent();
    expect(await prisma.post.count({ where: { id: p2 } })).toBe(1);
    setClock(() => new Date(Date.now() + 31 * DAY));
    await purgeRemovedContent();
    expect(await prisma.post.count({ where: { id: { in: [p2, p3] } } })).toBe(0);
    expect(await prisma.post.count({ where: { id: p1 } })).toBe(1);

    // Authors delete their own content; the Admin deletes any content directly (notified, audited).
    const mine = await mk(w.sA2, 'mine');
    expect((await w.sB1.delete(`/api/feed/posts/${mine}`)).status).toBe(403);
    const other = await mk(w.sA2, 'admin removes this');
    expect((await admin.c.delete(`/api/feed/posts/${other}`)).status).toBe(200);
    expect(await notes(w.a2.id, 'content_removed')).toHaveLength(1);
    expect((await w.sA2.delete(`/api/feed/posts/${mine}`)).status).toBe(200);
    expect(ids((await feed(w.sA2)).items)).not.toContain(mine);
  });

  it('[COMM-12] posts and comments accept at most 10 images of 5 MB each', async () => {
    const w = await world();
    const img = await png();
    const withImages = (n: number, size?: Buffer) => {
      const r = w.sA1.req('post', '/api/feed/posts').field('text', 'with pictures');
      for (let i = 0; i < n; i++) r.attach('images', size ?? img, { filename: `i${i}.png`, contentType: 'image/png' });
      return r;
    };
    const ten = await withImages(10);
    expect(ten.status).toBe(201);
    expect(ten.body.media).toHaveLength(10);
    expect(ten.body.media[0].signedUrl).toMatch(/^https:\/\//);
    expect((await withImages(11)).status).toBe(400);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(5 * 1024 * 1024 + 10)]);
    expect((await withImages(1, big)).status).toBe(400);
    const notImage = await withImages(1, Buffer.from('MZ not an image at all'));
    expect(notImage.status).toBe(400);
    // Comments: same limits; a PDF is allowed once.
    const p = ten.body.id as string;
    const c = w.sA2.req('post', `/api/feed/posts/${p}/comments`).field('text', 'pics');
    for (let i = 0; i < 10; i++) c.attach('images', img, { filename: `c${i}.png`, contentType: 'image/png' });
    const cr = await c;
    expect(cr.status).toBe(201);
    expect(cr.body.media).toHaveLength(10);
    const c11 = w.sA2.req('post', `/api/feed/posts/${p}/comments`).field('text', 'too many');
    for (let i = 0; i < 11; i++) c11.attach('images', img, { filename: `c${i}.png`, contentType: 'image/png' });
    expect((await c11).status).toBe(400);
    const pdf = await w.sA2.req('post', `/api/feed/posts/${p}/comments`).field('text', 'with pdf').attach('pdf', Buffer.from('%PDF-1.4\n%test\n'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(201);
    expect(pdf.body.pdf.name).toBe('a.pdf');
    // Editing may not push a post past 10 images.
    const edit = await w.sA1.req('patch', `/api/feed/posts/${p}`).attach('images', img, { filename: 'x.png', contentType: 'image/png' });
    expect(edit.status).toBe(400);
  });

  it('[COMM-13] the author line matches PRD §5.7.1 for student, teacher, Section Mentor, Admin and a deleted user', async () => {
    const sec = { name: 'A', group: { type: 'science' as const, session: { name: '2024–25' } } };
    expect(formatLine({ role: 'student', status: 'active', section: sec })).toBe('2024–25 · Science · A');
    expect(formatLine({ role: 'teacher', status: 'active' })).toBe('Teacher');
    expect(formatLine({ role: 'teacher', status: 'active', mentored: sec })).toBe('Teacher · Section Mentor · 2024–25 Science-A');
    expect(formatLine({ role: 'admin', status: 'active' })).toBe('Admin');
    expect(formatLine({ role: 'student', status: 'passed_out', section: sec })).toBeNull();

    const w = await world();
    const s = await mk(w.sA1, 'student');
    const m = await mk(w.mA, 'mentor');
    const t = await mk(w.tPlain, 'teacher');
    const a = await mk(admin.c as unknown as Api, 'admin');
    const get = async (id: string) => (await w.sB1.get(`/api/feed/posts/${id}`)).body.author as { name: string; line: string | null; id: string | null; avatarUrl: string | null; role: string | null };
    const session = (await prisma.section.findUniqueOrThrow({ where: { id: w.secA }, select: { group: { select: { session: { select: { name: true } } } } } })).group.session.name;
    expect((await get(s)).line).toBe(`${session} · Science · A`);
    expect((await get(m)).line).toBe(`Teacher · Section Mentor · ${session} Science-A`);
    expect((await get(t)).line).toBe('Teacher');
    expect((await get(a)).line).toBe('Admin');
    await prisma.user.update({ where: { id: w.a1.id }, data: { status: 'deleted' } });
    expect(await get(s)).toEqual({ id: null, name: 'Deleted user', avatarUrl: null, role: null, line: null });
    // Passed-out authors keep their posts with name and photo only.
    await prisma.user.update({ where: { id: w.a1.id }, data: { status: 'passed_out' } });
    const po = await get(s);
    expect(po.line).toBeNull();
    expect(po.name).toBe('Filler 0');
  });

  it('[COMM-14] creating a pinned post notifies its audience; an unpinned post sends no notification', async () => {
    const w = await world();
    const count = (u: User) => prisma.notification.count({ where: { userId: u.id, type: 'pinned_post' } });
    const before = { a1: await count(w.a1), a2: await count(w.a2), b1: await count(w.b1), t: await count(w.plain), m: await count(w.mentorA) };
    await mk(w.mA, 'unpinned', { pin: 'false' });
    await mk(admin.c as unknown as Api, 'unpinned admin', { pin: 'false' });
    expect(await count(w.a1)).toBe(before.a1);
    const mp = await mk(w.mA, 'mentor pin', { pin: 'true' });
    expect(await count(w.a1)).toBe(before.a1 + 1);
    expect(await count(w.a2)).toBe(before.a2 + 1);
    expect(await count(w.b1)).toBe(before.b1); // other section
    expect(await count(w.plain)).toBe(before.t);
    expect(await count(w.mentorA)).toBe(before.m); // not the author
    const n = await prisma.notification.findFirst({ where: { userId: w.a1.id, type: 'pinned_post', refId: mp } });
    expect(n?.refType).toBe('post');
    await mk(admin.c as unknown as Api, 'admin pin', { pin: 'true' });
    expect(await count(w.b1)).toBe(before.b1 + 1);
    expect(await count(w.plain)).toBe(before.t + 1);
    // A held pinned post is announced only after approval.
  });

  it('banned words: whole-word, Unicode-aware, case-insensitive', () => {
    const re = compileBanned(['Bad', 'বোকা']);
    expect(matchBanned('this is BAD!', re)).toBe(true);
    expect(matchBanned('badge and badly', re)).toBe(false);
    expect(matchBanned('তুমি বোকা না', re)).toBe(true);
    expect(matchBanned('বোকামি', re)).toBe(false);
    expect(matchBanned('anything', compileBanned([]))).toBe(false);
  });
});
