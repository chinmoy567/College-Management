import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { prisma } from '../../db';
import { setClock } from '../../lib/clock';
import { AppError } from '../../lib/http';
import { adminClient, classroom, clientFor, makeApp, uniq } from '../../../../../test/m5kit';
import { extractMaterialText } from './grounding';
import { FakeProvider, invalidateAiSettings, setProvider } from './provider';
import { startAnswer, takeDaily } from './service';

const app = makeApp();
let admin: Awaited<ReturnType<typeof adminClient>>;
type Room = Awaited<ReturnType<typeof classroom>>;
type Api = Awaited<ReturnType<typeof clientFor>>;
const fake = new FakeProvider();

const setSetting = async (key: string, value: string | number) => {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  invalidateAiSettings();
};
const resetFake = () => {
  fake.calls = [];
  fake.chunks = ['Hello ', 'from ', 'the fake AI.'];
  fake.fail = null;
  fake.failMidStream = false;
};
beforeAll(async () => {
  admin = await adminClient(prisma, app);
  setProvider(fake);
});
afterEach(() => {
  setClock(null);
  resetFake();
});
afterAll(async () => {
  setProvider(null);
  await prisma.setting.deleteMany({ where: { key: { in: ['ai_model', 'ai_provider', 'ai_daily_limit'] } } });
  invalidateAiSettings();
  await prisma.$disconnect();
});

const NOTES_MARK = 'Reference notes for this question';
const kid = (r: Room, i = 0) => clientFor(app, r.students[i]!);
const newConv = async (c: Api) => (await c.post('/api/ai/conversations', {})).body.id as string;
const say = (c: Api, conv: string, content: string, extra: object = {}) => c.req('post', `/api/ai/conversations/${conv}/messages`, { content, ...extra });
const textPdf = async (text: string) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 300]).drawText(text, { x: 20, y: 150, size: 12, font });
  return Buffer.from(await doc.save());
};
/** The teacher uploads a PDF note for the offering and the extract job runs on it. */
const addNote = async (r: Room, text: string) => {
  const t = await clientFor(app, r.teacher);
  const rq = t.req('post', '/api/materials');
  rq.field('scope', 'offering').field('courseOfferingId', r.offering.id).field('title', uniq('Note')).attach('files', await textPdf(text), { filename: 'n.pdf' });
  const res = await rq;
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const f = await prisma.materialFile.findFirstOrThrow({ where: { materialId: res.body.id } });
  await extractMaterialText(res.body.id, f.fileId);
  return res.body.id as string;
};

describe('AI study assistant', () => {
  it('[AI-01] non-students get 403 and anonymous callers 401; a student can chat and the answer streams', async () => {
    const r = await classroom(prisma, admin.c);
    const teacher = await clientFor(app, r.teacher);
    for (const c of [teacher, admin.c]) {
      expect((await c.get('/api/ai/conversations')).status).toBe(403);
      expect((await c.post('/api/ai/conversations', {})).status).toBe(403);
      expect((await c.get('/api/ai/usage/me')).status).toBe(403);
      expect((await c.post('/api/ai/conversations/cabcdefghijklmnopqrstu/messages', { content: 'hi' })).status).toBe(403);
    }
    const anon = (await import('./../../../../../test/factories')).client(app);
    expect((await anon.get('/api/ai/conversations')).status).toBe(401);
    expect(fake.calls).toHaveLength(0);

    const s = await kid(r);
    const conv = await newConv(s);
    const res = await say(s, conv, 'What is inertia?');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data: {"t":"Hello "}');
    expect(res.text).toContain('event: done');
    const msgs = (await s.get(`/api/ai/conversations/${conv}/messages`)).body.items;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].content).toBe('Hello from the fake AI.');
    const list = (await s.get('/api/ai/conversations')).body.items;
    expect(list.find((c: { id: string }) => c.id === conv).title).toBe('What is inertia?');
    expect((await say(s, conv, '')).status).toBe(400);
    expect((await say(s, conv, 'x'.repeat(4001))).status).toBe(400);
    // the 7th message in a minute is rate limited
    const t = await kid(r, 1);
    const c2 = await newConv(t);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await say(t, c2, `q${i}`)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 429]);
    // a second message sends the earlier turns
    expect(fake.calls.at(-2)!.messages.filter((m) => m.role === 'assistant').length).toBeGreaterThan(0);
  });

  it('[AI-02] the daily limit is exact with concurrent requests and uses the Asia/Dhaka date', async () => {
    await setSetting('ai_daily_limit', 20);
    const r = await classroom(prisma, admin.c);
    const s = r.students[0]!;
    const conv = (await prisma.aIConversation.create({ data: { studentId: s.id, title: 'x' } })).id;
    const run = async (i: number) => {
      const gen = await startAnswer({ id: s.id, role: 'student' }, conv, { content: `question ${i}` });
      for await (const chunk of gen) void chunk;
    };
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => run(i)));
    const ok = results.filter((x) => x.status === 'fulfilled').length;
    const denied = results.filter((x) => x.status === 'rejected' && (x.reason as AppError).code === 'AI_DAILY_LIMIT');
    expect(ok).toBe(20);
    expect(denied).toHaveLength(5);
    expect((denied[0] as PromiseRejectedResult).reason.message).toBe("You have used today's AI messages. Try again tomorrow.");
    expect((denied[0] as PromiseRejectedResult).reason.status).toBe(429);
    const usage = await prisma.aIUsage.findMany({ where: { studentId: s.id } });
    expect(usage).toHaveLength(1);
    expect(usage[0]!.messageCount).toBe(20);
    expect(await prisma.aIMessage.count({ where: { conversationId: conv, role: 'user' } })).toBe(20);
    const me = await (await clientFor(app, s)).get('/api/ai/usage/me');
    expect(me.body).toEqual({ usedToday: 20, limit: 20 });

    // 17:59 UTC is still today in Dhaka, 18:00 UTC is already tomorrow
    const s2 = r.students[1]!.id;
    setClock(() => new Date('2026-03-10T17:59:00Z'));
    expect(await takeDaily(s2, 1)).toBe(1);
    expect(await takeDaily(s2, 1)).toBeNull();
    setClock(() => new Date('2026-03-10T18:00:00Z'));
    expect(await takeDaily(s2, 1)).toBe(1);
    const days = (await prisma.aIUsage.findMany({ where: { studentId: s2 }, orderBy: { date: 'asc' } })).map((u) => u.date.toISOString().slice(0, 10));
    expect(days).toEqual(['2026-03-10', '2026-03-11']);
    await setSetting('ai_daily_limit', 20);
  });

  it('[AI-03] the AI is blocked while the student has an in-progress exam attempt, and works again after the deadline', async () => {
    const r = await classroom(prisma, admin.c);
    const t = await clientFor(app, r.teacher);
    const startAt = Date.now() + 3_600_000;
    const mk = await t.post('/api/exams', {
      offeringId: r.offering.id, kind: 'exam', title: uniq('Exam'), startAt: new Date(startAt).toISOString(), endAt: new Date(startAt + 3 * 3_600_000).toISOString(),
      durationMin: 30, passMarks: 1, maxAttempts: 1, resultMode: 'instant', showAnswersAfterEnd: true, shuffleQuestions: false, shuffleOptions: false,
    });
    expect(mk.status, JSON.stringify(mk.body)).toBe(201);
    const put = await t.put(`/api/exams/${mk.body.id}/questions`, { items: [{ inline: { type: 'single', text: 'Q1', marks: 1, correct: [0], options: [{ text: 'a' }, { text: 'b' }] } }] });
    expect(put.status).toBe(200);
    expect((await t.post(`/api/exams/${mk.body.id}/publish`)).status).toBe(200);
    const s = await kid(r);
    const conv = await newConv(s);
    setClock(() => new Date(startAt + 60_000));
    expect((await say(s, conv, 'before the exam')).status).toBe(200);
    const st = await s.post(`/api/exams/${mk.body.id}/attempts`);
    expect(st.status, JSON.stringify(st.body)).toBeLessThan(300);
    const calls = fake.calls.length;
    const blocked = await say(s, conv, 'help me with this exam question');
    expect(blocked.status).toBe(423);
    expect(blocked.body.error.code).toBe('AI_DISABLED_DURING_EXAM');
    expect(fake.calls).toHaveLength(calls);
    // blocked requests are not counted against the day
    expect((await s.get('/api/ai/usage/me')).body.usedToday).toBe(1);
    // another student in the same class is unaffected
    const other = await kid(r, 1);
    expect((await say(other, await newConv(other), 'hello')).status).toBe(200);
    // after the deadline the attempt is no longer live
    setClock(() => new Date(startAnswerAfter(startAt)));
    expect((await say(s, conv, 'after the exam')).status).toBe(200);
  });

  it('[AI-04] a provider error shows the busy message, never the raw error, and refunds the count', async () => {
    const r = await classroom(prisma, admin.c);
    const s = await kid(r);
    const conv = await newConv(s);
    fake.fail = new Error('429 Rate limit reached for model llama in org org_secret; key gsk_SECRET');
    const res = await say(s, conv, 'Explain gravity');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_BUSY');
    expect(res.body.error.message).toBe('The AI assistant is busy, please try again later.');
    expect(JSON.stringify(res.body)).not.toMatch(/gsk_|org_secret|Rate limit/);
    expect((await s.get('/api/ai/usage/me')).body.usedToday).toBe(0);
    expect(await prisma.aIMessage.count({ where: { conversationId: conv } })).toBe(0);
    // a failure half-way through the stream also refunds and ends with an error event
    fake.failMidStream = true;
    const mid = await say(s, conv, 'Explain gravity again');
    expect(mid.text).toContain('event: error');
    expect(mid.text).toContain('The AI assistant is busy');
    expect(mid.text).not.toContain('gsk_');
    expect((await s.get('/api/ai/usage/me')).body.usedToday).toBe(0);
    expect(await prisma.aIMessage.count({ where: { conversationId: conv, role: 'assistant' } })).toBe(0);
    // and it works once the provider is back
    resetFake();
    expect((await say(s, conv, 'Explain gravity')).status).toBe(200);
    expect((await s.get('/api/ai/usage/me')).body.usedToday).toBe(1);
  });

  it('[AI-05] the prompt sent to the provider contains no name, ID, phone or section', async () => {
    const r = await classroom(prisma, admin.c);
    const u = r.students[0]!;
    const name = 'Zarif Quasar Rahman';
    await prisma.studentProfile.update({ where: { userId: u.id }, data: { name, roll: '987654' } });
    await prisma.user.update({ where: { id: u.id }, data: { mobile: '01712345678' } });
    const section = await prisma.section.findUniqueOrThrow({ where: { id: r.sectionId } });
    await addNote(r, 'Inertia is the resistance of an object to a change in its motion.');
    const s = await clientFor(app, u);
    const conv = await newConv(s);
    await say(s, conv, 'Please explain inertia');
    await say(s, conv, 'And give a second example of inertia');
    expect(fake.calls).toHaveLength(2);
    const sent = JSON.stringify(fake.calls.map((c) => c.messages));
    for (const secret of [name, 'Zarif', 'Quasar', u.loginId!, '01712345678', '987654', u.id, r.sectionId, u.email ?? 'no-email', `Section ${section.name}`, `section ${section.name}`]) expect(sent, secret).not.toContain(secret);
    expect(sent).toContain('Reference notes for this question');
    expect(sent).toContain('resistance of an object');
    // student text is never in the system role
    for (const m of fake.calls[1]!.messages.filter((x) => x.role === 'system')) expect(m.content).not.toContain('second example');
  }, 60_000);

  it('[AI-06] grounding uses only materials from the student own courses and drops deleted materials', async () => {
    const r = await classroom(prisma, admin.c);
    const other = await classroom(prisma, admin.c);
    const mine = await addNote(r, 'Chlorophyll absorbs sunlight during photosynthesis in leaves.');
    await addNote(other, 'Mitochondria produce ATP, the ribosome builds proteins. Photosynthesis too.');
    expect(await prisma.materialChunk.count({ where: { materialId: mine } })).toBe(1);
    const s = await kid(r);
    const conv = await newConv(s);
    await say(s, conv, 'Tell me about mitochondria and ribosome');
    expect(JSON.stringify(fake.calls[0]!.messages)).not.toContain(NOTES_MARK);
    await say(s, conv, 'How does chlorophyll work in photosynthesis?');
    const prompt = JSON.stringify(fake.calls[1]!.messages);
    expect(prompt).toContain('Chlorophyll absorbs sunlight');
    expect(prompt).not.toContain('Mitochondria');
    // a course the student is not in gives nothing, even when asked for explicitly
    await say(s, conv, 'photosynthesis', { courseId: other.course.id });
    expect(JSON.stringify(fake.calls[2]!.messages)).not.toContain(NOTES_MARK);
    // the notes block is bounded
    expect(prompt.match(/Reference notes for this question/g)).toHaveLength(1);
    // deleting the material deletes its chunks
    const t = await clientFor(app, r.teacher);
    expect((await t.delete(`/api/materials/${mine}`)).status).toBe(200);
    expect(await prisma.materialChunk.count({ where: { materialId: mine } })).toBe(0);
    await say(s, conv, 'How does chlorophyll work in photosynthesis?');
    expect(JSON.stringify(fake.calls[3]!.messages)).not.toContain('Chlorophyll absorbs');
  }, 60_000);

  it('[AI-07] chats are private: other students get 404, teachers and the admin 403; the admin sees usage counts only', async () => {
    const r = await classroom(prisma, admin.c);
    const s = await kid(r);
    const conv = await newConv(s);
    const secret = `private-question-${uniq('x')}`;
    await say(s, conv, secret);
    const other = await kid(r, 1);
    expect((await other.get(`/api/ai/conversations/${conv}/messages`)).status).toBe(404);
    expect((await other.delete(`/api/ai/conversations/${conv}`)).status).toBe(404);
    expect((await say(other, conv, 'hi')).status).toBe(404);
    expect(JSON.stringify((await other.get('/api/ai/conversations')).body)).not.toContain(secret);
    const teacher = await clientFor(app, r.teacher);
    for (const c of [teacher, admin.c]) {
      expect((await c.get(`/api/ai/conversations/${conv}/messages`)).status).toBe(403);
      expect((await c.get('/api/ai/conversations')).status).toBe(403);
    }
    expect((await teacher.get('/api/admin/ai/usage')).status).toBe(403);
    expect((await s.get('/api/admin/ai/usage')).status).toBe(403);
    const usage = await admin.c.get('/api/admin/ai/usage');
    expect(usage.status).toBe(200);
    expect(JSON.stringify(usage.body)).not.toContain(secret);
    expect(usage.body.days.reduce((n: number, d: { count: number }) => n + d.count, 0)).toBeGreaterThanOrEqual(1);
    expect(usage.body.sections.some((x: { sectionId: string }) => x.sectionId === r.sectionId)).toBe(true);
    for (const k of Object.keys(usage.body)) expect(['from', 'to', 'days', 'sections']).toContain(k);
    // student 360 and every other route never touch the AI tables: only modules/ai and the anonymise code mention them
    const root = path.resolve(__dirname, '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) && /aIConversation|aIMessage|aIUsage|ai_conversations|ai_messages|ai_usage/.test(readFileSync(p, 'utf8'))) hits.push(path.relative(root, p).replace(/\\/g, '/'));
      }
    };
    walk(root);
    expect(hits.filter((h) => !h.startsWith('modules/ai/') && h !== 'modules/users/service.ts')).toEqual([]);
    // deleting a conversation removes its messages
    expect((await s.delete(`/api/ai/conversations/${conv}`)).status).toBe(200);
    expect(await prisma.aIMessage.count({ where: { conversationId: conv } })).toBe(0);
  });

  it('[AI-08] provider and model come from Settings; the Groq key never reaches the browser', async () => {
    const r = await classroom(prisma, admin.c);
    const s = await kid(r);
    const conv = await newConv(s);
    await setSetting('ai_model', 'model-one');
    await say(s, conv, 'first');
    await setSetting('ai_model', 'model-two');
    await say(s, conv, 'second');
    expect(fake.calls.map((c) => c.model)).toEqual(['model-one', 'model-two']);
    // an unknown provider is a friendly failure, not a crash, and is refunded
    setProvider(null);
    await setSetting('ai_provider', 'someone-else');
    const bad = await say(s, conv, 'third');
    expect(bad.status).toBe(503);
    expect(bad.body.error.code).toBe('AI_BUSY');
    expect((await s.get('/api/ai/usage/me')).body.usedToday).toBe(2);
    setProvider(fake);
    await prisma.setting.deleteMany({ where: { key: { in: ['ai_model', 'ai_provider'] } } });
    invalidateAiSettings();
    await say(s, conv, 'fourth');
    expect(fake.calls.at(-1)!.model).toBe('llama-3.3-70b-versatile');

    // the key and the SDK exist only in apps/api; nothing in the web app or its build mentions them
    const web = path.resolve(__dirname, '../../../../web');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        if (f === 'node_modules' || f === 'cache' || f === 'server') continue;
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs|css|html|map|json)$/.test(f) && /GROQ|groq-sdk|gsk_/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(path.join(web, 'src'));
    try {
      walk(path.join(web, '.next', 'static'));
    } catch {
      /* no build yet */
    }
    expect(offenders).toEqual([]);
    // no API response carries the key either
    expect(JSON.stringify((await s.get('/api/ai/usage/me')).body)).not.toMatch(/gsk_|GROQ/);
  });
});

const startAnswerAfter = (startAt: number) => startAt + 60_000 + 31 * 60_000;
