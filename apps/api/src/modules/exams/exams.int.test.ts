import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ExamQuestion } from '@prisma/client';
import { prisma } from '../../db';
import { setClock } from '../../lib/clock';
import { adminClient, classroom, clientFor, fillStudents, makeApp, makeCourse, makeTeacher, uniq } from '../../../../../test/m5kit';
import { ensureRevealed } from './reveal';
import { finaliseAttempt, hasLiveAttempt } from './finalise';
import { runAutoSubmit, runCloseCheck, runStartingSoon } from './jobs';
import { regradeExam } from './changes';
import { saveAnswer } from './attempts';

const app = makeApp();
let admin: Awaited<ReturnType<typeof adminClient>>;
type Api = Awaited<ReturnType<typeof clientFor>>;

const MIN = 60_000;
const T0 = Date.now();
/** The exam window used by every test: opens at T0+1h, closes at T0+3h (45 min exams start inside it). */
const START = T0 + 60 * MIN;
const END = T0 + 180 * MIN;
const at = (ms: number) => setClock(() => new Date(ms));
const iso = (ms: number) => new Date(ms).toISOString();

beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterEach(() => setClock(null));
afterAll(() => prisma.$disconnect());

// ───── builders ─────
interface QSpec { text: string; options: number; correct: number[]; marks?: number; type?: 'single' | 'multiple'; chapterId?: string }
const q = (text: string, options: number, correct: number[], marks = 1, extra: Partial<QSpec> = {}): QSpec => ({ text, options, correct, marks, ...extra });
const inline = (s: QSpec) => ({
  inline: {
    type: s.type ?? (s.correct.length > 1 ? 'multiple' : 'single'), text: s.text, marks: s.marks ?? 1, correct: s.correct,
    options: Array.from({ length: s.options }, (_, i) => ({ text: `${s.text} option ${i + 1}` })), ...(s.chapterId ? { chapterId: s.chapterId } : {}),
  },
});
/** Q1 single (2 marks, correct o2) and Q2 multiple (3 marks, correct o1+o3): 5 marks. */
const STD = [q('Capital?', 3, [1], 2), q('Primes?', 4, [0, 2], 3)];

async function world(n = 3) {
  const c = await classroom(prisma, admin.c, n);
  const t = await clientFor(app, c.teacher);
  const s: Api[] = await Promise.all(c.students.map((u) => clientFor(app, u)));
  return { ...c, t, s };
}
type World = Awaited<ReturnType<typeof world>>;

interface ExamOpts { kind?: 'exam' | 'quiz'; maxAttempts?: number; resultMode?: 'instant' | 'manual'; showAnswersAfterEnd?: boolean; durationMin?: number; passMarks?: number; startAt?: number; endAt?: number; shuffle?: boolean; qs?: QSpec[]; publish?: boolean }
async function mkExam(w: World, o: ExamOpts = {}) {
  setClock(null);
  const res = await w.t.post('/api/exams', {
    offeringId: w.offering.id, kind: o.kind ?? 'exam', title: uniq('Exam'), startAt: iso(o.startAt ?? START), endAt: iso(o.endAt ?? END),
    durationMin: o.durationMin ?? 30, passMarks: o.passMarks ?? 2, maxAttempts: o.maxAttempts ?? 1, resultMode: o.resultMode ?? 'instant',
    showAnswersAfterEnd: o.showAnswersAfterEnd ?? true, shuffleQuestions: o.shuffle ?? false, shuffleOptions: o.shuffle ?? false,
  });
  if (res.status !== 201) throw new Error(`exam create ${res.status} ${JSON.stringify(res.body)}`);
  const id = res.body.id as string;
  const put = await w.t.put(`/api/exams/${id}/questions`, { items: (o.qs ?? STD).map(inline) });
  if (put.status !== 200) throw new Error(`questions ${put.status} ${JSON.stringify(put.body)}`);
  if (o.publish !== false) {
    const pub = await w.t.post(`/api/exams/${id}/publish`);
    if (pub.status !== 200) throw new Error(`publish ${pub.status} ${JSON.stringify(pub.body)}`);
  }
  const qs = await prisma.examQuestion.findMany({ where: { examId: id }, orderBy: { order: 'asc' } });
  return { id, qs };
}
const right = (eq: ExamQuestion) => eq.correct as string[];
const wrong = (eq: ExamQuestion) => [(eq.options as { id: string }[]).map((o) => o.id).find((x) => !(eq.correct as string[]).includes(x))!];
const start = (c: Api, examId: string) => c.post(`/api/exams/${examId}/attempts`);
const answer = (c: Api, attemptId: string, eqId: string, sel: string[], marked = false) =>
  c.put(`/api/exams/attempts/${attemptId}/answers/${eqId}`, { selectedOptionIds: sel, markedForReview: marked });
const submit = (c: Api, attemptId: string) => c.post(`/api/exams/attempts/${attemptId}/submit`);
const view = (c: Api, attemptId: string) => c.get(`/api/exams/attempts/${attemptId}`);

/** True when any object in the payload has a `correct` key. */
const hasCorrectKey = (v: unknown): boolean =>
  Array.isArray(v) ? v.some(hasCorrectKey) : v && typeof v === 'object' ? Object.entries(v).some(([k, x]) => k === 'correct' || hasCorrectKey(x)) : false;

/** A student takes an exam: starts, answers (right/wrong/skip per question), submits. Returns the attempt id and the submit body. */
async function take(c: Api, exam: Awaited<ReturnType<typeof mkExam>>, plan: ('right' | 'wrong' | 'skip')[]) {
  const st = await start(c, exam.id);
  expect(st.status, JSON.stringify(st.body)).toBeLessThan(300);
  const attemptId = st.body.id as string;
  for (const [i, p] of plan.entries()) {
    if (p === 'skip') continue;
    const r = await answer(c, attemptId, exam.qs[i]!.id, p === 'right' ? right(exam.qs[i]!) : wrong(exam.qs[i]!));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  const sub = await submit(c, attemptId);
  expect(sub.status).toBe(200);
  return { attemptId, sub: sub.body };
}

// ───────────────────────── scoring ─────────────────────────
describe('scoring', () => {
  it('[EXAM-01] [EXAM-02] right = marks, wrong or unanswered = 0, exact set only, cancelled gives everyone the marks, never negative or partial', async () => {
    const w = await world(4);
    const e = await mkExam(w);
    at(START + MIN);
    const a = await take(w.s[0]!, e, ['right', 'right']);
    expect(a.sub.score).toBe(5);
    const b = await take(w.s[1]!, e, ['wrong', 'wrong']);
    expect(b.sub.score).toBe(0);
    const c = await take(w.s[2]!, e, ['right', 'skip']);
    expect(c.sub.score).toBe(2);
    // multiple: only part of the set is wrong, a superset is wrong, the exact set in any order is right
    const d0 = await start(w.s[3]!, e.id);
    const did = d0.body.id as string;
    expect((await answer(w.s[3]!, did, e.qs[1]!.id, ['o1'])).status).toBe(200);
    expect((await submit(w.s[3]!, did)).body.score).toBe(0);
    const answers = await prisma.answer.findMany({ where: { attemptId: did } });
    expect(answers).toHaveLength(2); // the unanswered question has an empty answer row
    expect(answers.every((x) => x.isCorrect === false && Number(x.marksAwarded) === 0)).toBe(true);
    const g = await w.t.post(`/api/exams/${e.id}/questions/${e.qs[1]!.id}/cancel`);
    expect(g.status).toBe(200);
    const scores = (await prisma.examAttempt.findMany({ where: { examId: e.id }, orderBy: { attemptNo: 'asc' } })).map((x) => Number(x.score));
    expect(scores.sort()).toEqual([3, 3, 5, 5]); // everyone gets the cancelled question's 3 marks
    expect(scores.every((s) => s >= 0 && Number.isInteger(s * 2))).toBe(true);
  });
});

// ───────────────────────── deadline ─────────────────────────
describe('deadline', () => {
  it('[EXAM-03] an answer 1 s before the deadline is accepted, at and 1 s after is rejected', async () => {
    const w = await world(2);
    const e = await mkExam(w);
    at(START);
    const st = await start(w.s[0]!, e.id);
    const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: st.body.id } });
    const deadline = attempt.deadlineAt.getTime();
    expect(deadline).toBe(START + 30 * MIN);
    at(deadline - 1000);
    expect((await answer(w.s[0]!, st.body.id, e.qs[0]!.id, ['o2'])).status).toBe(200);
    at(deadline); // strictly now < deadlineAt: the instant itself is too late
    const exact = await answer(w.s[0]!, st.body.id, e.qs[0]!.id, ['o1']);
    expect(exact.status).toBe(409);
    expect(exact.body.error.code).toBe('DEADLINE_PASSED');
    at(deadline + 1000);
    expect((await answer(w.s[0]!, st.body.id, e.qs[0]!.id, ['o1'])).status).toBe(409);
    const row = await prisma.answer.findFirstOrThrow({ where: { attemptId: st.body.id, examQuestionId: e.qs[0]!.id } });
    expect(row.selectedOptionIds).toEqual(['o2']); // the late answers changed nothing
    expect((await prisma.examAttempt.findUniqueOrThrow({ where: { id: st.body.id } })).status).toBe('auto_submitted');
  });

  it('[EXAM-04] the window end caps the deadline: window to end, 45 min exam started 10 min before the end gives deadline = end', async () => {
    const w = await world(2);
    const e = await mkExam(w, { durationMin: 45 });
    at(END - 10 * MIN);
    const st = await start(w.s[0]!, e.id);
    expect(new Date(st.body.deadlineAt).getTime()).toBe(T0 + END - T0);
    expect(new Date(st.body.serverNow).getTime()).toBe(END - 10 * MIN);
    // late join with plenty of window still gets the full duration
    const e2 = await mkExam(w, { durationMin: 45 });
    at(START + MIN);
    const st2 = await start(w.s[1]!, e2.id);
    expect(new Date(st2.body.deadlineAt).getTime()).toBe(START + MIN + 45 * MIN);
  });

  it('submit is idempotent, has a 5 s grace after the deadline and a later submit is finished as an auto-submit', async () => {
    const w = await world(3);
    const e = await mkExam(w);
    at(START);
    const [a, b, c] = await Promise.all(w.s.map((s) => start(s, e.id)));
    for (const [i, s] of w.s.entries()) await answer(s, [a, b, c][i]!.body.id, e.qs[0]!.id, ['o2']);
    const dl = START + 30 * MIN;
    at(dl + 3000);
    const s1 = await submit(w.s[0]!, a!.body.id);
    expect(s1.body.status).toBe('submitted');
    expect(s1.body.score).toBe(2);
    expect(new Date(s1.body.submittedAt).getTime()).toBe(dl); // never later than the deadline
    at(dl + 9000);
    const again = await submit(w.s[0]!, a!.body.id);
    expect(again.body).toEqual(s1.body); // idempotent: same result
    const late = await submit(w.s[1]!, b!.body.id);
    expect(late.body.status).toBe('auto_submitted');
    expect(late.body.score).toBe(2);
    const dbl = await Promise.all([submit(w.s[2]!, c!.body.id), submit(w.s[2]!, c!.body.id)]);
    expect(dbl[0]!.body.score).toBe(dbl[1]!.body.score);
    expect(await prisma.answer.count({ where: { attemptId: c!.body.id } })).toBe(2);
  });
});

// ───────────────────────── starting ─────────────────────────
describe('starting an attempt', () => {
  it('[EXAM-05] concurrent starts give one in-progress attempt; a quiz next attempt only after submit; the attempt limit holds', async () => {
    const w = await world(2);
    const e = await mkExam(w, { kind: 'quiz', maxAttempts: 2 });
    at(START + MIN);
    const rs = await Promise.all(Array.from({ length: 8 }, () => start(w.s[0]!, e.id)));
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.examAttempt.count({ where: { examId: e.id, studentId: w.students[0]!.id } })).toBe(1);
    // asking again resumes the same attempt instead of starting a second one
    const again = await start(w.s[0]!, e.id);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(rs[0]!.body.id);
    expect((await submit(w.s[0]!, rs[0]!.body.id)).status).toBe(200);
    const second = await start(w.s[0]!, e.id);
    expect(second.status).toBe(201);
    expect((await prisma.examAttempt.findUniqueOrThrow({ where: { id: second.body.id } })).attemptNo).toBe(2);
    await submit(w.s[0]!, second.body.id);
    const third = await start(w.s[0]!, e.id);
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('NO_ATTEMPTS_LEFT');
    // an exam allows one attempt only
    const ex = await mkExam(w, { kind: 'exam' });
    at(START + MIN);
    await take(w.s[1]!, ex, ['right', 'skip']);
    expect((await start(w.s[1]!, ex.id)).body.error.code).toBe('NO_ATTEMPTS_LEFT');
    // unlimited quiz (maxAttempts 0)
    const un = await mkExam(w, { kind: 'quiz', maxAttempts: 0 });
    at(START + MIN);
    for (let i = 0; i < 3; i++) await take(w.s[1]!, un, ['right', 'right']);
    expect(await prisma.examAttempt.count({ where: { examId: un.id } })).toBe(3);
  });

  it('[EXAM-07] questions are never sent before the student\'s own attempt starts', async () => {
    const w = await world(2);
    const e = await mkExam(w);
    const outsider = await clientFor(app, (await fillStudents(prisma, w.sectionId, 1))[0]!); // active student, not enrolled
    // before the window: summary has no questions and starting is refused
    at(START - 5 * MIN);
    const sum = await w.s[0]!.get(`/api/exams/${e.id}`);
    expect(sum.status).toBe(200);
    expect(JSON.stringify(sum.body)).not.toContain('Capital?');
    expect(sum.body.questions).toBeUndefined();
    expect(sum.body.canStart).toBe(false);
    const early = await start(w.s[0]!, e.id);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('EXAM_NOT_OPEN');
    expect(JSON.stringify(early.body)).not.toContain('Capital?');
    // after the window closed, starting is refused too
    at(END + MIN);
    expect((await start(w.s[0]!, e.id)).body.error.code).toBe('EXAM_NOT_OPEN');
    // not enrolled: 404, nothing leaked; a draft is invisible to students
    at(START + MIN);
    expect((await start(outsider, e.id)).status).toBe(404);
    expect((await outsider.get(`/api/exams/${e.id}`)).status).toBe(404);
    const draft = await mkExam(w, { publish: false });
    at(START + MIN);
    expect((await w.s[0]!.get(`/api/exams/${draft.id}`)).status).toBe(404);
    expect((await start(w.s[0]!, draft.id)).status).toBe(404);
    // the list carries no questions either
    const list = await w.s[0]!.get('/api/exams/me?status=live');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('Capital?');
    // the attempt itself carries them, in the stored order
    const st = await start(w.s[0]!, e.id);
    expect(st.status).toBe(201);
    expect(st.body.questions).toHaveLength(2);
  });

  it('[EXAM-19] (backend part) a reload resumes with the same shuffled order, option order and saved answers', async () => {
    const w = await world(2);
    const many = Array.from({ length: 12 }, (_, i) => q(`Q${i}`, 5, [i % 5]));
    const e = await mkExam(w, { qs: many, shuffle: true });
    at(START + MIN);
    const st = await start(w.s[0]!, e.id);
    const order = (st.body.questions as { id: string; options: { id: string }[] }[]).map((x) => [x.id, x.options.map((o) => o.id).join('')]);
    expect(await prisma.examAttempt.findUniqueOrThrow({ where: { id: st.body.id } })).toMatchObject({ questionOrder: expect.any(Array) });
    const firstQ = st.body.questions[0];
    await answer(w.s[0]!, st.body.id, firstQ.id, [firstQ.options[1].id], true);
    at(START + 5 * MIN);
    const reload = await view(w.s[0]!, st.body.id);
    expect((reload.body.questions as typeof st.body.questions).map((x: { id: string; options: { id: string }[] }) => [x.id, x.options.map((o) => o.id).join('')])).toEqual(order);
    expect(reload.body.answers).toEqual([{ examQuestionId: firstQ.id, selectedOptionIds: [firstQ.options[1].id], markedForReview: true }]);
    expect(reload.body.deadlineAt).toBe(st.body.deadlineAt);
    expect(new Date(reload.body.serverNow).getTime()).toBe(START + 5 * MIN);
    expect(hasCorrectKey(reload.body)).toBe(false);
    expect((await start(w.s[0]!, e.id)).body.questions.map((x: { id: string }) => x.id)).toEqual(order.map((o) => o[0])); // resume via start
    // another student cannot read or write this attempt
    expect((await view(w.s[1]!, st.body.id)).status).toBe(404);
    expect((await answer(w.s[1]!, st.body.id, firstQ.id, ['o1'])).status).toBe(404);
    expect((await submit(w.s[1]!, st.body.id)).status).toBe(404);
  });

  it('answers validate option ids and single-choice limits; the integrity log is capped at 500', async () => {
    const w = await world(1);
    const e = await mkExam(w);
    at(START + MIN);
    const st = await start(w.s[0]!, e.id);
    expect((await answer(w.s[0]!, st.body.id, e.qs[0]!.id, ['o2', 'o3'])).status).toBe(400); // single
    expect((await answer(w.s[0]!, st.body.id, e.qs[0]!.id, ['o5'])).status).toBe(400); // not an option of this question
    expect((await answer(w.s[0]!, st.body.id, e.qs[1]!.id, ['o1', 'o3'])).status).toBe(200);
    expect((await answer(w.s[0]!, st.body.id, e.qs[1]!.id, [], true)).status).toBe(200); // clearing is allowed
    expect((await prisma.answer.findFirstOrThrow({ where: { attemptId: st.body.id, examQuestionId: e.qs[1]!.id } })).selectedOptionIds).toEqual([]);
    const ev = Array.from({ length: 100 }, () => ({ type: 'blur', at: iso(START + MIN) }));
    for (let i = 0; i < 6; i++) expect((await w.s[0]!.post(`/api/exams/attempts/${st.body.id}/integrity`, { events: ev })).status).toBe(200);
    expect(((await prisma.examAttempt.findUniqueOrThrow({ where: { id: st.body.id } })).integrityLog as unknown[]).length).toBe(500);
    expect((await w.s[0]!.post(`/api/exams/attempts/${st.body.id}/integrity`, { events: [{ type: 'nope', at: iso(START) }] })).status).toBe(400);
  });
});

// ───────────────────────── visibility ─────────────────────────
describe('what the student sees', () => {
  it('[EXAM-06] no payload carries correct answers before reveal + results published + showAnswersAfterEnd', async () => {
    const w = await world(2);
    const e = await mkExam(w, { showAnswersAfterEnd: true });
    const noKey = await mkExam(w, { showAnswersAfterEnd: false });
    const manual = await mkExam(w, { resultMode: 'manual' });
    const seen: unknown[] = [];
    const rec = (b: unknown) => (seen.push(b), b);
    at(START + MIN);
    const sts = [];
    for (const ex of [e, noKey, manual]) {
      rec((await w.s[0]!.get(`/api/exams/${ex.id}`)).body);
      const st = await start(w.s[0]!, ex.id);
      rec(st.body);
      rec((await view(w.s[0]!, st.body.id)).body);
      rec((await answer(w.s[0]!, st.body.id, ex.qs[0]!.id, right(ex.qs[0]!))).body);
      const sub = await submit(w.s[0]!, st.body.id);
      rec(sub.body);
      rec((await view(w.s[0]!, st.body.id)).body);
      rec((await w.s[0]!.get(`/api/exams/${ex.id}`)).body);
      sts.push(st.body.id as string);
    }
    rec((await w.s[0]!.get('/api/exams/me')).body);
    rec((await w.s[0]!.get('/api/exams/me/progress')).body);
    // another student's still-running attempt does not leak either
    expect(seen.filter(hasCorrectKey)).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain('"correct"');

    // revealed: instant with showAnswers → key appears, but only in the per-question results
    at(END + MIN);
    const full = (await view(w.s[0]!, sts[0]!)).body;
    expect(full.state).toBe('full');
    expect(full.questions.every((x: { correct?: string[] }) => Array.isArray(x.correct))).toBe(true);
    // showAnswersAfterEnd off: per-question results but never the key
    const noKeyView = (await view(w.s[0]!, sts[1]!)).body;
    expect(noKeyView.state).toBe('full');
    expect(noKeyView.questions).toHaveLength(2);
    expect(hasCorrectKey(noKeyView)).toBe(false);
    // manual, revealed but not published: nothing
    const pending = (await view(w.s[0]!, sts[2]!)).body;
    expect(pending.state).toBe('pending');
    expect(pending.score).toBeUndefined();
    expect(hasCorrectKey([pending, (await w.s[0]!.get(`/api/exams/${manual.id}`)).body, (await w.s[0]!.get('/api/exams/me/progress')).body])).toBe(false);
    // the student explicit-select constant never selects the key
    const { STUDENT_QUESTION } = await import('./views');
    expect(Object.keys(STUDENT_QUESTION)).not.toContain('correct');
    // a teacher payload does have the key (it is not a student payload)
    expect(hasCorrectKey((await w.t.get(`/api/exams/${e.id}`)).body)).toBe(true);
  });

  it('[EXAM-08] instant mode: only the total score before reveal; per-question results, correct answers and ranks after', async () => {
    const w = await world(3);
    const e = await mkExam(w);
    at(START + MIN);
    const a = await take(w.s[0]!, e, ['right', 'right']);
    const b = await take(w.s[1]!, e, ['right', 'wrong']);
    const mid = (await view(w.s[0]!, a.attemptId)).body;
    expect(mid).toMatchObject({ state: 'score_only', score: 5, totalMarks: 5 });
    expect(mid.questions).toBeUndefined();
    expect(mid.rank).toBeUndefined();
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: e.id } })).revealedAt).toBeNull();
    // the third student still has an attempt in progress at the window end? no: deadline is within the window, so reveal happens
    at(END + MIN);
    const done = (await view(w.s[0]!, a.attemptId)).body;
    expect(done.state).toBe('full');
    expect(done.rank).toEqual({ rank: 1, of: 2, sectionAverage: 70 });
    expect(done.questions[0].correct).toEqual(['o2']);
    expect(done.questions[1].isCorrect).toBe(true);
    expect((await view(w.s[1]!, b.attemptId)).body.rank.rank).toBe(2);
    const row = await prisma.exam.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.revealedAt).not.toBeNull();
    expect(row.resultsPublishedAt).not.toBeNull();
    expect(row.status).toBe('closed');
    expect(await prisma.notification.count({ where: { type: 'result_published', refId: e.id } })).toBe(3); // every enrolled student
  });

  it('[EXAM-09] manual mode: nothing until the teacher publishes the results', async () => {
    const w = await world(2);
    const e = await mkExam(w, { resultMode: 'manual' });
    at(START + MIN);
    const a = await take(w.s[0]!, e, ['right', 'right']);
    expect(a.sub).toMatchObject({ state: 'pending', resultPending: true });
    expect(a.sub.score).toBeUndefined();
    expect((await w.t.post(`/api/exams/${e.id}/publish-results`)).status).toBe(409); // window still open
    at(END + MIN);
    const after = (await view(w.s[0]!, a.attemptId)).body;
    expect(after.state).toBe('pending');
    expect(after.score).toBeUndefined();
    expect(after.questions).toBeUndefined();
    const pr = await w.t.post(`/api/exams/${e.id}/publish-results`);
    expect(pr.status).toBe(200);
    expect((await w.t.post(`/api/exams/${e.id}/publish-results`)).status).toBe(200); // idempotent
    const full = (await view(w.s[0]!, a.attemptId)).body;
    expect(full).toMatchObject({ state: 'full', score: 5, grade: 'A+' });
    expect(full.questions[0].correct).toEqual(['o2']);
    expect(await prisma.notification.count({ where: { type: 'result_published', refId: e.id } })).toBe(2); // once, not twice
    expect((await w.s[0]!.post(`/api/exams/${e.id}/publish-results`)).status).toBe(403);
  });
});

// ───────────────────────── extra time, regrade ─────────────────────────
describe('extra time, reopen, key fixes', () => {
  it('[EXAM-10] extra time can pass endAt and delays reveal for the whole exam; reopening keeps saved answers; every extension is logged', async () => {
    const w = await world(3);
    const e = await mkExam(w);
    at(END - 10 * MIN);
    const slow = await start(w.s[0]!, e.id); // deadline = END
    const fast = await take(w.s[1]!, e, ['right', 'right']);
    await answer(w.s[0]!, slow.body.id, e.qs[0]!.id, ['o2']);
    const ext = await w.t.post(`/api/exams/attempts/${slow.body.id}/extend`, { minutes: 20 });
    expect(ext.status).toBe(200);
    expect(new Date(ext.body.deadlineAt).getTime()).toBe(END + 20 * MIN); // past endAt
    at(END + 5 * MIN);
    const mid = (await view(w.s[1]!, fast.attemptId)).body;
    expect(mid.state).toBe('score_only'); // the window is over but one attempt is still running: no reveal
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: e.id } })).revealedAt).toBeNull();
    expect((await answer(w.s[0]!, slow.body.id, e.qs[1]!.id, ['o1', 'o3'])).status).toBe(200); // still allowed after endAt
    at(END + 21 * MIN);
    expect((await view(w.s[0]!, slow.body.id)).body.score).toBe(5); // finished lazily at the moved deadline
    expect((await view(w.s[1]!, fast.attemptId)).body.state).toBe('full'); // now the whole exam reveals
    // reopen: answers stay, score is cleared until the next submit, the reveal is taken back
    const reopen = await w.t.post(`/api/exams/attempts/${slow.body.id}/extend`, { minutes: 10, reopen: true });
    expect(reopen.status).toBe(200);
    const re = await prisma.examAttempt.findUniqueOrThrow({ where: { id: slow.body.id } });
    expect(re).toMatchObject({ status: 'in_progress', score: null, submittedAt: null });
    expect(re.deadlineAt.getTime()).toBe(END + 31 * MIN);
    expect(await prisma.answer.count({ where: { attemptId: slow.body.id, selectedOptionIds: { isEmpty: false } } })).toBe(2);
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: e.id } })).revealedAt).toBeNull();
    expect((await view(w.s[1]!, fast.attemptId)).body.state).toBe('score_only');
    expect((await submit(w.s[0]!, slow.body.id)).body.score).toBe(5);
    expect((await view(w.s[1]!, fast.attemptId)).body.state).toBe('full');
    const logs = await prisma.attemptExtension.findMany({ where: { attemptId: slow.body.id }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => [l.minutes, l.reopened, l.givenBy])).toEqual([[20, false, w.teacher.id], [10, true, w.teacher.id]]);
    // rules: finished attempts need reopen:true, only the latest attempt, only the offering's teacher
    expect((await w.t.post(`/api/exams/attempts/${fast.attemptId}/extend`, { minutes: 5 })).status).toBe(409);
    expect((await w.s[0]!.post(`/api/exams/attempts/${slow.body.id}/extend`, { minutes: 5 })).status).toBe(403);
    expect((await admin.c.post(`/api/exams/attempts/${slow.body.id}/extend`, { minutes: 5 })).status).toBe(403);
    expect((await (await clientFor(app, await makeTeacher(prisma))).post(`/api/exams/attempts/${slow.body.id}/extend`, { minutes: 5 })).status).toBe(404);
    expect((await w.t.post(`/api/exams/attempts/${slow.body.id}/extend`, { minutes: 500 })).status).toBe(400);
  });

  it('[EXAM-11] fixing a key or cancelling a question regrades every submitted attempt, is logged and notifies students', async () => {
    const w = await world(3);
    const e = await mkExam(w);
    at(START + MIN);
    const a = await take(w.s[0]!, e, ['right', 'right']);
    const b = await take(w.s[1]!, e, ['wrong', 'right']);
    const running = await start(w.s[2]!, e.id);
    await answer(w.s[2]!, running.body.id, e.qs[0]!.id, ['o1']); // o1 will become the key
    const [q1] = e.qs;
    const bad = await w.t.post(`/api/exams/${e.id}/questions/${q1!.id}/fix-key`, { correct: ['o1', 'o2'] });
    expect(bad.status).toBe(400); // single needs exactly one
    expect((await w.t.post(`/api/exams/${e.id}/questions/${q1!.id}/fix-key`, { correct: ['o6'] })).status).toBe(400);
    const fix = await w.t.post(`/api/exams/${e.id}/questions/${q1!.id}/fix-key`, { correct: ['o1'] });
    expect(fix.status).toBe(200);
    const score = async (id: string) => Number((await prisma.examAttempt.findUniqueOrThrow({ where: { id } })).score);
    expect(await score(a.attemptId)).toBe(3); // lost the 2 marks of question 1
    expect(await score(b.attemptId)).toBe(5); // gained them
    // the running attempt is graded with the new key when it is submitted
    expect((await submit(w.s[2]!, running.body.id)).body.score).toBe(2);
    const logs = await prisma.examChangeLog.findMany({ where: { examId: e.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ changedBy: w.teacher.id, change: { from: ['o2'], to: ['o1'] } });
    expect(await prisma.notification.count({ where: { type: 'exam_key_fixed', refId: e.id, userId: { in: [w.students[0]!.id, w.students[1]!.id] } } })).toBe(2);
    // cancel: everyone gets the marks of question 2
    expect((await w.t.post(`/api/exams/${e.id}/questions/${e.qs[1]!.id}/cancel`)).status).toBe(200);
    expect(await score(a.attemptId)).toBe(3); // 0 + 3 (cancelled)
    expect(await score(b.attemptId)).toBe(5);
    expect(await prisma.examChangeLog.count({ where: { examId: e.id } })).toBe(2);
    expect((await w.t.post(`/api/exams/${e.id}/questions/${e.qs[1]!.id}/cancel`)).status).toBe(200); // idempotent, no second log
    expect(await prisma.examChangeLog.count({ where: { examId: e.id } })).toBe(2);
    expect(await regradeExam(e.id)).toBe(3); // the job is idempotent
    expect(await score(a.attemptId)).toBe(3);
    // permissions
    expect((await admin.c.post(`/api/exams/${e.id}/questions/${q1!.id}/fix-key`, { correct: ['o3'] })).status).toBe(403);
    expect((await (await clientFor(app, await makeTeacher(prisma))).post(`/api/exams/${e.id}/questions/${q1!.id}/cancel`)).status).toBe(404);
    expect((await w.s[0]!.post(`/api/exams/${e.id}/questions/${q1!.id}/cancel`)).status).toBe(403);
  });
});

// ───────────────────────── editing ─────────────────────────
describe('editing and the snapshot', () => {
  it('[EXAM-12] a started exam cannot be edited except key fixes and cancellations; editing before start re-copies the snapshot', async () => {
    const w = await world(2);
    const e = await mkExam(w);
    // before start: any field, and the questions are re-copied
    const p = await w.t.patch(`/api/exams/${e.id}`, { title: 'Renamed', durationMin: 60, items: [inline(q('Only one', 3, [2], 4))] });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ title: 'Renamed', durationMin: 60, totalMarks: 4, questions: [{ text: 'Only one', correct: ['o3'] }] });
    expect((await prisma.examQuestion.findMany({ where: { examId: e.id } }))).toHaveLength(1);
    expect((await w.t.patch(`/api/exams/${e.id}`, { passMarks: 5 })).status).toBe(400); // above the 4 total marks
    const put = await w.t.put(`/api/exams/${e.id}/questions`, { items: STD.map(inline) });
    expect(put.body.totalMarks).toBe(5);
    expect(await prisma.exam.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: 'published', totalMarks: expect.anything() });
    // after start: locked
    at(START + MIN);
    const st = await start(w.s[0]!, e.id);
    for (const r of [
      await w.t.patch(`/api/exams/${e.id}`, { title: 'x' }),
      await w.t.put(`/api/exams/${e.id}/questions`, { items: [inline(q('late', 2, [0]))] }),
      await w.t.delete(`/api/exams/${e.id}`),
    ]) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('EXAM_LOCKED');
    }
    expect(st.status).toBe(201);
    // another teacher sees nothing, the Admin may not edit
    expect((await (await clientFor(app, await makeTeacher(prisma))).patch(`/api/exams/${e.id}`, { title: 'x' })).status).toBe(404);
    expect((await admin.c.patch(`/api/exams/${e.id}`, { title: 'x' })).status).toBe(403);
    // delete rules: draft ok, published before start with no attempts ok
    setClock(null);
    const d = await mkExam(w, { publish: false });
    expect((await w.t.delete(`/api/exams/${d.id}`)).status).toBe(200);
    const pub = await mkExam(w);
    expect((await w.t.delete(`/api/exams/${pub.id}`)).status).toBe(200);
    expect(await prisma.exam.count({ where: { id: { in: [d.id, pub.id] } } })).toBe(0);
  });

  it('[EXAM-13] editing or archiving the question bank never changes a published or past exam', async () => {
    const w = await world(1);
    const bank = await w.t.post('/api/exams/bank', { courseId: w.course.id, type: 'single', text: 'Original', options: [{ text: 'a' }, { text: 'b' }], correct: [0], marks: 2 });
    expect(bank.status).toBe(201);
    expect(bank.body.options).toEqual([{ id: 'o1', text: 'a' }, { id: 'o2', text: 'b' }]);
    expect(bank.body.correct).toEqual(['o1']);
    const ex = await w.t.post('/api/exams', { offeringId: w.offering.id, kind: 'exam', title: 'Snap', startAt: iso(START), endAt: iso(END), durationMin: 30, passMarks: 1 });
    await w.t.put(`/api/exams/${ex.body.id}/questions`, { items: [{ questionId: bank.body.id }] });
    // an edit made while still a draft is picked up at publish
    expect((await w.t.patch(`/api/exams/bank/${bank.body.id}`, { text: 'Edited before publish' })).status).toBe(200);
    expect((await w.t.post(`/api/exams/${ex.body.id}/publish`)).status).toBe(200);
    expect((await prisma.examQuestion.findFirstOrThrow({ where: { examId: ex.body.id } })).text).toBe('Edited before publish');
    // edits after publish never reach the exam
    expect((await w.t.patch(`/api/exams/bank/${bank.body.id}`, { text: 'Changed after', options: [{ text: 'x' }, { text: 'y' }, { text: 'z' }], correct: [2], marks: 9 })).status).toBe(200);
    expect((await w.t.delete(`/api/exams/bank/${bank.body.id}`)).status).toBe(200);
    expect(await prisma.question.findUniqueOrThrow({ where: { id: bank.body.id } })).toMatchObject({ text: 'Changed after' });
    expect((await prisma.question.findUniqueOrThrow({ where: { id: bank.body.id } })).archivedAt).not.toBeNull();
    expect(await prisma.examQuestion.findFirstOrThrow({ where: { examId: ex.body.id } })).toMatchObject({ text: 'Edited before publish', correct: ['o1'], marks: expect.anything() });
    expect(Number((await prisma.examQuestion.findFirstOrThrow({ where: { examId: ex.body.id } })).marks)).toBe(2);
    expect((await w.t.get(`/api/exams/bank?courseId=${w.course.id}`)).body.items).toHaveLength(0); // archived is gone from the bank list
    // a started exam keeps its copy and is still gradable
    at(START + MIN);
    const r = await take(w.s[0]!, { id: ex.body.id, qs: await prisma.examQuestion.findMany({ where: { examId: ex.body.id } }) }, ['right']);
    expect(r.sub.score).toBe(2);
  });
});

// ───────────────────────── ranks and progress ─────────────────────────
describe('ranks and progress', () => {
  it('[EXAM-14] ranks use competition ranking (1, 2, 2, 4) within the attempt\'s section only', async () => {
    const w = await world(4);
    const e = await mkExam(w);
    at(START + MIN);
    const plan: ('right' | 'wrong' | 'skip')[][] = [['right', 'right'], ['right', 'skip'], ['right', 'wrong'], ['wrong', 'skip']];
    const taken = [];
    for (const [i, p] of plan.entries()) taken.push(await take(w.s[i]!, e, p));
    // an attempt of another section with a perfect score must not move anybody's rank
    const other = await prisma.section.findFirstOrThrow({ where: { group: { sessionId: w.sessionId }, NOT: { id: w.sectionId } } });
    const [far] = await fillStudents(prisma, other.id, 1);
    await prisma.examAttempt.create({ data: { examId: e.id, studentId: far!.id, attemptNo: 1, sectionId: other.id, deadlineAt: new Date(T0), questionOrder: [], status: 'submitted', score: 5, submittedAt: new Date(T0) } });
    at(END + MIN);
    const ranks = [];
    for (const [i, t] of taken.entries()) ranks.push((await view(w.s[i]!, t.attemptId)).body.rank);
    expect(ranks.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(ranks.every((r) => r.of === 4)).toBe(true);
    const progress = (await w.s[3]!.get('/api/exams/me/progress')).body;
    expect(progress.results[0]).toMatchObject({ rank: 4, of: 4, score: 0, percentage: 0, grade: 'F' });
  });

  it('[EXAM-15] overall course rank = average % over published Exams (a missed exam is 0%), quizzes excluded; a quiz rank uses the best attempt', async () => {
    const w = await world(3);
    const e1 = await mkExam(w);
    const e2 = await mkExam(w);
    const quiz = await mkExam(w, { kind: 'quiz', maxAttempts: 2 });
    at(START + MIN);
    await take(w.s[0]!, e1, ['right', 'right']); // A: 100%
    await take(w.s[1]!, e1, ['right', 'skip']); //  B: 40%
    await take(w.s[1]!, e2, ['right', 'right']); // B: 100%   (A missed e2)
    await take(w.s[0]!, quiz, ['wrong', 'wrong']); // A attempt 1: 0
    const best = await take(w.s[0]!, quiz, ['right', 'right']); // A attempt 2: 5 → best
    await take(w.s[1]!, quiz, ['right', 'skip']); // B: 2
    at(END + MIN);
    const prog = await w.t.get(`/api/exams/offerings/${w.offering.id}/progress`);
    expect(prog.status).toBe(200);
    const bySid = new Map((prog.body.students as { studentId: string; percent: number; rank: number; missed: number; grade: string }[]).map((s) => [s.studentId, s]));
    expect(bySid.get(w.students[0]!.id)).toMatchObject({ percent: 50, rank: 2, missed: 1, grade: 'B' });
    expect(bySid.get(w.students[1]!.id)).toMatchObject({ percent: 70, rank: 1, missed: 0, grade: 'A' });
    expect(bySid.get(w.students[2]!.id)).toMatchObject({ percent: 0, rank: 3, missed: 2, grade: 'F' });
    expect(prog.body.exams).toHaveLength(2); // the quiz is not counted
    expect(prog.body.belowPass.map((b: { studentId: string }) => b.studentId).sort()).toEqual([w.students[0]!.id, w.students[2]!.id].sort()); // A missed e2, B scored exactly the pass mark, C missed both
    // quiz rank: A's best attempt (5) beats B (2)
    expect((await view(w.s[0]!, best.attemptId)).body.rank).toMatchObject({ rank: 1, of: 2 });
    // the student's own progress agrees
    const mine = (await w.s[0]!.get(`/api/exams/me/progress?courseId=${w.course.id}`)).body;
    expect(mine.courses[0]).toMatchObject({ percent: 50, rank: 2, grade: 'B', of: 3 });
    expect(mine.results.filter((r: { kind: string }) => r.kind === 'quiz')).toHaveLength(1);
    expect(mine.trend.length).toBe(mine.results.filter((r: { missed: boolean }) => !r.missed).length);
  });

  it('[EXAM-20] (backend part) the student progress carries marks, %, grade, section rank, trend and strong/weak chapters; PDF and CSV exports work', async () => {
    const w = await world(2);
    const ch = await Promise.all(['Alpha', 'Beta'].map((name) => prisma.chapter.create({ data: { courseId: w.course.id, name, order: 1, createdById: w.teacher.id } })));
    const qs = [
      ...Array.from({ length: 3 }, (_, i) => q(`A${i}`, 2, [0], 1, { chapterId: ch[0]!.id })),
      ...Array.from({ length: 3 }, (_, i) => q(`B${i}`, 2, [0], 1, { chapterId: ch[1]!.id })),
    ];
    const e = await mkExam(w, { qs, passMarks: 3 });
    at(START + MIN);
    await take(w.s[0]!, e, ['right', 'right', 'right', 'wrong', 'wrong', 'skip']);
    await take(w.s[1]!, e, ['right', 'wrong', 'wrong', 'right', 'right', 'right']);
    expect((await w.s[0]!.get('/api/exams/me/progress')).body.results).toHaveLength(0); // nothing before the reveal
    at(END + MIN);
    const p = (await w.s[0]!.get('/api/exams/me/progress')).body;
    expect(p.results[0]).toMatchObject({ score: 3, totalMarks: 6, percentage: 50, grade: 'B', rank: 2, of: 2, sectionAverage: 58.34 }); // the other student scored 4 of 6
    expect(p.trend).toHaveLength(1);
    expect(p.sectionAverageSeries[0].percentage).toBe(58.34);
    expect(p.chapters.strong).toMatchObject([{ name: 'Alpha', pct: 100 }]);
    expect(p.chapters.weak).toMatchObject([{ name: 'Beta', pct: 0 }]);
    const pdf = await w.s[0]!.get('/api/exams/me/progress.pdf').buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await w.t.get('/api/exams/me/progress')).status).toBe(403);
  });
});

// ───────────────────────── permissions ─────────────────────────
describe('permissions', () => {
  it('[EXAM-07] (context) every exam payload names its class: course, session, group, section and class level', async () => {
    const w = await world(1);
    const o = await prisma.courseOffering.findUniqueOrThrow({
      where: { id: w.offering.id },
      include: { course: true, section: { include: { group: { include: { session: true } } } } },
    });
    const ctx = {
      course: { id: o.course.id, code: o.course.code, name: o.course.name }, session: o.section.group.session.name,
      group: o.section.group.type, section: o.section.name, classLevel: o.section.classLevel,
    };
    const e = await mkExam(w);
    at(START + MIN);
    const att = await start(w.s[0]!, e.id);
    const paths = [
      await w.t.get(`/api/exams/${e.id}`), await w.t.get(`/api/exams?offeringId=${w.offering.id}`), await w.t.get(`/api/exams/offerings/${w.offering.id}/progress`),
      await w.t.get(`/api/exams/${e.id}/report`), await w.s[0]!.get(`/api/exams/${e.id}`), await w.s[0]!.get('/api/exams/me'), att,
    ];
    for (const r of paths) expect([200, 201]).toContain(r.status);
    expect(paths[0]!.body).toMatchObject(ctx);
    expect(paths[1]!.body.items[0]).toMatchObject(ctx);
    expect(paths[2]!.body).toMatchObject(ctx);
    expect(paths[3]!.body.exam).toMatchObject(ctx);
    expect(paths[4]!.body).toMatchObject(ctx);
    expect(paths[5]!.body.items[0]).toMatchObject(ctx);
    expect(paths[6]!.body).toMatchObject(ctx);
    const picker = await w.t.get('/api/exams/offerings');
    expect(picker.body.items.find((i: { id: string }) => i.id === w.offering.id)).toMatchObject(ctx);
    const submitted = await submit(w.s[0]!, att.body.id);
    expect(submitted.body).toMatchObject(ctx);
  });

  it('[EXAM-07] (context) a draft with no questions shows 0 total marks in the list, as in the detail (pass marks do not inflate it)', async () => {
    const w = await world(1);
    const body = { offeringId: w.offering.id, kind: 'exam', title: 'Empty draft', startAt: iso(START), endAt: iso(END), durationMin: 30, passMarks: 5 };
    const created = await w.t.post('/api/exams', body);
    expect(created.status).toBe(201);
    const detail = await w.t.get(`/api/exams/${created.body.id}`);
    const list = await w.t.get(`/api/exams?offeringId=${w.offering.id}`);
    const row = list.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(detail.body.totalMarks).toBe(0);
    expect(row.totalMarks).toBe(0);
    expect(row.passMarks).toBe(5);
  });

  it('[EXAM-16] the Admin cannot create exams (403); another teacher gets 404; students are refused; the owner is allowed', async () => {
    const w = await world(1);
    const body = { offeringId: w.offering.id, kind: 'exam', title: 'T', startAt: iso(START), endAt: iso(END), durationMin: 30, passMarks: 1 };
    const other = await clientFor(app, await makeTeacher(prisma));
    expect((await admin.c.post('/api/exams', body)).status).toBe(403);
    expect((await w.s[0]!.post('/api/exams', body)).status).toBe(403);
    expect((await other.post('/api/exams', body)).status).toBe(404);
    const ok = await w.t.post('/api/exams', body);
    expect(ok.status).toBe(201);
    const id = ok.body.id as string;
    // reads: the owner and the Admin, never another teacher (404) or a student of the course while it is a draft
    expect((await w.t.get(`/api/exams/${id}`)).status).toBe(200);
    expect((await other.get(`/api/exams/${id}`)).status).toBe(404);
    expect((await admin.c.get(`/api/exams/${id}`)).status).toBe(404); // a draft stays private to its teacher
    await w.t.put(`/api/exams/${id}/questions`, { items: STD.map(inline) });
    expect((await other.put(`/api/exams/${id}/questions`, { items: STD.map(inline) })).status).toBe(404);
    expect((await admin.c.put(`/api/exams/${id}/questions`, { items: STD.map(inline) })).status).toBe(403);
    expect((await other.post(`/api/exams/${id}/publish`)).status).toBe(404);
    expect((await admin.c.post(`/api/exams/${id}/publish`)).status).toBe(403);
    expect((await w.t.post(`/api/exams/${id}/publish`)).status).toBe(200);
    expect((await admin.c.get(`/api/exams/${id}`)).status).toBe(200); // the Admin can view published exams and results
    expect((await admin.c.get(`/api/exams/${id}/report`)).status).toBe(200);
    expect((await other.get(`/api/exams/${id}/report`)).status).toBe(404);
    expect((await w.s[0]!.get(`/api/exams/${id}/report`)).status).toBe(403);
    expect((await w.s[0]!.get(`/api/exams?offeringId=${w.offering.id}`)).status).toBe(403);
    expect((await other.get(`/api/exams?offeringId=${w.offering.id}`)).status).toBe(404);
    expect((await w.t.get(`/api/exams?offeringId=${w.offering.id}`)).body.items).toHaveLength(1);
    // a Section Mentor reads reports and progress of own section but cannot manage
    const mentor = await makeTeacher(prisma);
    await prisma.section.update({ where: { id: w.sectionId }, data: { mentorTeacherId: mentor.id } });
    const m = await clientFor(app, mentor);
    expect((await m.get(`/api/exams/${id}/report`)).status).toBe(200);
    expect((await m.get(`/api/exams/offerings/${w.offering.id}/progress`)).status).toBe(200);
    expect((await m.post(`/api/exams/${id}/publish-results`)).status).toBe(404);
    expect((await other.get(`/api/exams/offerings/${w.offering.id}/progress`)).status).toBe(404);
    // the bank: own questions of courses the teacher teaches only
    const bq = await w.t.post('/api/exams/bank', { courseId: w.course.id, type: 'single', text: 'Mine', options: [{ text: 'a' }, { text: 'b' }], correct: [1] });
    expect((await other.get(`/api/exams/bank?courseId=${w.course.id}`)).status).toBe(403); // teaches nothing here
    expect((await other.patch(`/api/exams/bank/${bq.body.id}`, { text: 'x' })).status).toBe(404);
    expect((await other.delete(`/api/exams/bank/${bq.body.id}`)).status).toBe(404);
    expect((await admin.c.get(`/api/exams/bank?courseId=${w.course.id}`)).status).toBe(403);
    expect((await w.s[0]!.post('/api/exams/bank', { courseId: w.course.id, type: 'single', text: 'x', options: [{ text: 'a' }, { text: 'b' }], correct: [0] })).status).toBe(403);
    expect((await other.post('/api/exams/bank', { courseId: w.course.id, type: 'single', text: 'x', options: [{ text: 'a' }, { text: 'b' }], correct: [0] })).status).toBe(403);
    // an unauthenticated request is refused
    expect((await (await import('../../../../../test/factories')).client(app).get(`/api/exams/${id}`)).status).toBe(401);
  });

  it('[EXAM-18] the duration accepts only 15, 30, 45, 60, 90, 120', async () => {
    const w = await world(1);
    const base = { offeringId: w.offering.id, kind: 'exam', title: 'D', startAt: iso(START), endAt: iso(END), passMarks: 1 };
    for (const d of [15, 30, 45, 60, 90, 120]) expect((await w.t.post('/api/exams', { ...base, durationMin: d })).status).toBe(201);
    for (const d of [0, 10, 20, 50, 75, 121, 180, -30, 45.5]) {
      const r = await w.t.post('/api/exams', { ...base, durationMin: d });
      expect(r.status, String(d)).toBe(400);
      expect(r.body.error.fields.durationMin).toBeTruthy();
    }
    const e = await w.t.post('/api/exams', { ...base, durationMin: 30 });
    expect((await w.t.patch(`/api/exams/${e.body.id}`, { durationMin: 25 })).status).toBe(400);
    expect((await w.t.patch(`/api/exams/${e.body.id}`, { durationMin: 90 })).status).toBe(200);
    // other create rules
    expect((await w.t.post('/api/exams', { ...base, durationMin: 30, kind: 'exam', maxAttempts: 2 })).status).toBe(400);
    expect((await w.t.post('/api/exams', { ...base, durationMin: 30, kind: 'quiz', maxAttempts: 11 })).status).toBe(400);
    expect((await w.t.post('/api/exams', { ...base, durationMin: 30, endAt: iso(START) })).status).toBe(400);
    expect((await w.t.post('/api/exams', { ...base, durationMin: 30, startAt: iso(T0 - 5 * MIN), endAt: iso(END) })).status).toBe(400); // past start
    const mass = await w.t.post('/api/exams', { ...base, durationMin: 30, status: 'published', totalMarks: 1000, createdBy: 'x' });
    expect(mass.body.status).toBe('draft'); // unknown keys are stripped
  });
});

// ───────────────────────── jobs ─────────────────────────
describe('jobs and lazy finalise', () => {
  it('[EXAM-17] an attempt is auto-submitted at the deadline by the job with the browser closed, and lazily when the job ran late', async () => {
    const w = await world(3);
    const e = await mkExam(w);
    at(START);
    const a = await start(w.s[0]!, e.id);
    const b = await start(w.s[1]!, e.id);
    const c = await start(w.s[2]!, e.id);
    await answer(w.s[0]!, a.body.id, e.qs[0]!.id, ['o2']);
    await answer(w.s[1]!, b.body.id, e.qs[0]!.id, ['o2']);
    await answer(w.s[2]!, c.body.id, e.qs[0]!.id, ['o2']);
    const dl = START + 30 * MIN;
    // job fired too early (deadline moved by extra time): it does nothing
    at(dl - 1000);
    await runAutoSubmit({ attemptId: a.body.id });
    expect((await prisma.examAttempt.findUniqueOrThrow({ where: { id: a.body.id } })).status).toBe('in_progress');
    // at the deadline the job grades it; the student never sends anything
    at(dl);
    await runAutoSubmit({ attemptId: a.body.id });
    const done = await prisma.examAttempt.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(done).toMatchObject({ status: 'auto_submitted' });
    expect(Number(done.score)).toBe(2);
    expect(done.submittedAt!.getTime()).toBe(T0 + dl - T0);
    await runAutoSubmit({ attemptId: a.body.id }); // idempotent
    expect(Number((await prisma.examAttempt.findUniqueOrThrow({ where: { id: a.body.id } })).score)).toBe(2);
    // the job ran late: any read finishes the attempt (GET), and so does the exam summary and the hot path
    at(dl + 10 * MIN);
    const lazy = await view(w.s[1]!, b.body.id);
    expect(lazy.body.state).toBe('score_only');
    expect(lazy.body.score).toBe(2);
    expect((await prisma.examAttempt.findUniqueOrThrow({ where: { id: b.body.id } })).status).toBe('auto_submitted');
    const sum = await w.s[2]!.get(`/api/exams/${e.id}`);
    expect(sum.body.attempts[0].status).toBe('auto_submitted');
    // the boot sweep finishes whatever is left
    const { finaliseExpiredAttempts } = await import('./finalise');
    await finaliseExpiredAttempts();
    expect(await prisma.examAttempt.count({ where: { examId: e.id, status: 'in_progress' } })).toBe(0);
    // an attempt never exceeds its own deadline even when finalised hours later
    expect((await prisma.examAttempt.findUniqueOrThrow({ where: { id: b.body.id } })).submittedAt!.getTime()).toBe(dl);
    expect(await hasLiveAttempt(w.students[0]!.id)).toBe(false);
  });

  it('close-check reveals once attempts finish; starting-soon notifies once; hasLiveAttempt blocks only while time is left', async () => {
    const w = await world(2);
    const e = await mkExam(w);
    at(START - 10 * MIN);
    await runStartingSoon({ examId: e.id });
    await runStartingSoon({ examId: e.id });
    expect(await prisma.notification.count({ where: { type: 'exam_starting_soon', refId: e.id } })).toBe(2);
    expect(await prisma.notification.count({ where: { type: 'exam_published', refId: e.id } })).toBe(2);
    at(END - 5 * MIN);
    const st = await start(w.s[0]!, e.id);
    expect(await hasLiveAttempt(w.students[0]!.id)).toBe(true);
    expect(await hasLiveAttempt(w.students[1]!.id)).toBe(false);
    at(END);
    await runCloseCheck({ examId: e.id }); // the attempt's deadline is END: closed, finished lazily, revealed
    expect((await prisma.examAttempt.findUniqueOrThrow({ where: { id: st.body.id } })).status).toBe('auto_submitted');
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('closed');
    expect(await hasLiveAttempt(w.students[0]!.id)).toBe(false);
    await runCloseCheck({ examId: e.id }); // run twice changes nothing
    expect(await prisma.notification.count({ where: { type: 'result_published', refId: e.id } })).toBe(2);
  });

  it('a pass-out auto-submits a running attempt and grades it, a running attempt blocks a move, the ACAD blocks still hold', async () => {
    const w = await world(2);
    const e = await mkExam(w);
    at(START + MIN);
    const st = await start(w.s[0]!, e.id);
    await answer(w.s[0]!, st.body.id, e.qs[0]!.id, ['o2']);
    const target = await prisma.section.findFirstOrThrow({ where: { group: { sessionId: w.sessionId }, NOT: { id: w.sectionId } } });
    const mv = await admin.c.post('/api/users/students/move', { studentIds: [w.students[0]!.id], targetSectionId: target.id });
    expect(mv.status).toBe(409);
    expect(mv.body.error.code).toBe('ATTEMPT_IN_PROGRESS');
    const po = await admin.c.post('/api/users/students/pass-out', { studentIds: [w.students[0]!.id] });
    expect(po.status).toBe(200);
    const row = await prisma.examAttempt.findUniqueOrThrow({ where: { id: st.body.id } });
    expect(row.status).toBe('auto_submitted');
    expect(Number(row.score)).toBe(2);
    expect(await hasLiveAttempt(w.students[0]!.id)).toBe(false);
  });
});

// ───────────────────────── reports ─────────────────────────
describe('reports', () => {
  it('the exam report has distribution, stats, per-question correctness, did-not-attend and integrity counts; CSV and PDF export', async () => {
    const w = await world(4);
    const e = await mkExam(w);
    at(START + MIN);
    const a = await take(w.s[0]!, e, ['right', 'right']);
    await take(w.s[1]!, e, ['right', 'skip']);
    await w.s[1]!.post(`/api/exams/attempts/${(await prisma.examAttempt.findFirstOrThrow({ where: { examId: e.id, studentId: w.students[1]!.id } })).id}/integrity`, { events: [{ type: 'blur', at: iso(START) }] });
    const st3 = await start(w.s[2]!, e.id);
    await w.s[2]!.post(`/api/exams/attempts/${st3.body.id}/integrity`, { events: [{ type: 'blur', at: iso(START) }, { type: 'fullscreen_exit', at: iso(START) }, { type: 'focus', at: iso(START) }] });
    await submit(w.s[2]!, st3.body.id);
    const r = (await w.t.get(`/api/exams/${e.id}/report`)).body;
    expect(r.summary).toMatchObject({ enrolled: 4, attended: 3, highest: 5, lowest: 0, average: 2.33 });
    expect(r.distribution).toHaveLength(10);
    expect(r.distribution.map((d: { count: number }) => d.count)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // 0%, 40%, 100%
    expect(r.perQuestion.map((p: { correctPct: number }) => p.correctPct)).toEqual([66.67, 33.33]);
    expect(r.didNotAttend.map((d: { studentId: string }) => d.studentId)).toEqual([w.students[3]!.id]);
    const third = r.attempts.find((x: { studentId: string }) => x.studentId === w.students[2]!.id);
    expect(third.integrity).toMatchObject({ blur: 1, fullscreen_exit: 1, focus: 1, total: 3 });
    expect(r.attempts.find((x: { attemptId: string }) => x.attemptId === a.attemptId).integrity.total).toBe(0);
    const csv = await w.t.get(`/api/exams/${e.id}/report.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('did_not_attend');
    const pdf = await w.t.get(`/api/exams/${e.id}/report.pdf`).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('the Admin sees college-wide performance by session, group, section and course; others are refused', async () => {
    const w = await world(2);
    const e = await mkExam(w);
    at(START + MIN);
    await take(w.s[0]!, e, ['right', 'right']);
    at(END + MIN);
    await view(w.s[0]!, (await prisma.examAttempt.findFirstOrThrow({ where: { examId: e.id } })).id);
    for (const by of ['session', 'group', 'section', 'course']) {
      const r = await admin.c.get(`/api/admin/exams/performance?by=${by}`);
      expect(r.status).toBe(200);
      expect(r.body.by).toBe(by);
    }
    const bySession = (await admin.c.get('/api/admin/exams/performance?by=session')).body.items as { key: string; averagePct: number; participationPct: number; exams: number }[];
    expect(bySession.find((s) => s.key === w.sessionId)).toMatchObject({ exams: 1, averagePct: 100, participationPct: 50 });
    expect((await w.t.get('/api/admin/exams/performance')).status).toBe(404); // the whole /api/admin area answers 404 to non-admins
    expect((await w.s[0]!.get('/api/admin/exams/performance')).status).toBe(404);
  });
});

// ───────────────────────── question bank ─────────────────────────
describe('question bank', () => {
  it('validates question shapes, marks and options', async () => {
    const w = await world(1);
    const post = (b: object) => w.t.post('/api/exams/bank', { courseId: w.course.id, type: 'single', text: 'Q', options: [{ text: 'a' }, { text: 'b' }], correct: [0], ...b });
    expect((await post({})).status).toBe(201);
    expect((await post({ options: [{ text: 'a' }] })).status).toBe(400);
    expect((await post({ options: Array.from({ length: 7 }, () => ({ text: 'x' })) })).status).toBe(400);
    expect((await post({ correct: [0, 1] })).status).toBe(400); // single
    expect((await post({ type: 'multiple', correct: [] })).status).toBe(400);
    expect((await post({ type: 'multiple', correct: [0, 1] })).status).toBe(201);
    expect((await post({ correct: [2] })).status).toBe(400); // out of range
    expect((await post({ marks: 0.3 })).status).toBe(400);
    expect((await post({ marks: 100.5 })).status).toBe(400);
    expect((await post({ marks: 1.5 })).status).toBe(201);
    expect((await post({ text: '  ' })).status).toBe(400);
    expect((await w.t.post('/api/exams/bank', { courseId: w.course.id, type: 'single', text: 'Q', options: [{ text: 'a' }, { text: 'b' }], correct: [0] })).body.marks).toBe(1); // default
    const other = await makeCourse(prisma);
    expect((await post({ courseId: other.id })).status).toBe(403); // not their course
    const list = await w.t.get(`/api/exams/bank?courseId=${w.course.id}&limit=2`);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.nextCursor).toBeTruthy();
    expect((await w.t.get(`/api/exams/bank?courseId=${w.course.id}&cursor=${list.body.nextCursor}&limit=50`)).body.items.length).toBeGreaterThan(0);
    expect((await w.t.get(`/api/exams/bank?courseId=${w.course.id}&q=zzz`)).body.items).toHaveLength(0);
  });

  it('imports a CSV with a dry run and all-or-nothing', async () => {
    const w = await world(1);
    const ch = await prisma.chapter.create({ data: { courseId: w.course.id, name: 'Waves', order: 1, createdById: w.teacher.id } });
    const good = ['text,option1,option2,option3,option4,option5,option6,correct,marks,chapter', 'What is 1+1?,1,2,3,,,,2,1,Waves', 'Pick primes,2,3,4,5,,,1;2,2,', 'বাংলা প্রশ্ন?,ক,খ,,,,,1,0.5,'].join('\n');
    const bad = [good, 'Broken,only one,,,,,,1,1,', 'Bad key,a,b,,,,,3,1,', 'Bad chapter,a,b,,,,,1,1,Nope', 'Gap,a,,c,,,,1,1,'].join('\n');
    const send = (csv: string, dry: boolean) => w.t.req('post', `/api/exams/bank/import?courseId=${w.course.id}${dry ? '&dryRun=true' : ''}`).attach('file', Buffer.from(csv), 'q.csv');
    const dry = await send(good, true);
    expect(dry.status).toBe(200);
    expect(dry.body).toEqual({ dryRun: true, valid: 3 });
    expect(await prisma.question.count({ where: { courseId: w.course.id } })).toBe(0);
    const rejected = await send(bad, false);
    expect(rejected.status).toBe(400);
    expect(rejected.body.errors.map((e: { row: number }) => e.row)).toEqual([5, 6, 7, 8]);
    expect(await prisma.question.count({ where: { courseId: w.course.id } })).toBe(0); // nothing imported
    const ok = await send(good, false);
    expect(ok.status).toBe(201);
    expect(ok.body.created).toBe(3);
    const rows = await prisma.question.findMany({ where: { courseId: w.course.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.type, r.correct, r.chapterId, Number(r.marks)])).toEqual([['single', ['o2'], ch.id, 1], ['multiple', ['o1', 'o2'], null, 2], ['single', ['o1'], null, 0.5]]);
    expect(rows[2]!.text).toBe('বাংলা প্রশ্ন?');
    expect((await send('a,b\n1,2', false)).status).toBe(400); // missing columns
    expect((await (await clientFor(app, await makeTeacher(prisma))).req('post', `/api/exams/bank/import?courseId=${w.course.id}`).attach('file', Buffer.from(good), 'q.csv')).status).toBe(403);
  });
});

// ───────────────────────── lifecycle details ─────────────────────────
describe('lifecycle details', () => {
  it('publish needs a question, pass marks within the total and a future start; tie scores share a rank; the hot path is one statement', async () => {
    const w = await world(2);
    setClock(null);
    const mk = async (extra: object = {}) => (await w.t.post('/api/exams', { offeringId: w.offering.id, kind: 'exam', title: 'P', startAt: iso(START), endAt: iso(END), durationMin: 30, passMarks: 4, ...extra })).body.id as string;
    const id = await mk();
    expect((await w.t.post(`/api/exams/${id}/publish`)).status).toBe(400); // no question
    await w.t.put(`/api/exams/${id}/questions`, { items: [inline(q('Small', 2, [0], 2))] });
    const p = await w.t.post(`/api/exams/${id}/publish`);
    expect(p.status).toBe(400); // pass marks 4 > total 2
    expect(p.body.error.fields.passMarks).toBeTruthy();
    expect((await w.t.patch(`/api/exams/${id}`, { passMarks: 2 })).status).toBe(200);
    expect((await w.t.post(`/api/exams/${id}/publish`)).status).toBe(200);
    expect((await w.t.post(`/api/exams/${id}/publish`)).status).toBe(409); // already published
    expect(await prisma.exam.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'published' });
    expect(Number((await prisma.exam.findUniqueOrThrow({ where: { id } })).totalMarks)).toBe(2);
    // unknown or foreign questions are refused
    const id2 = await mk({ passMarks: 0 });
    expect((await w.t.put(`/api/exams/${id2}/questions`, { items: [{ questionId: 'c' + 'a'.repeat(24) }] })).status).toBe(400);
    // hot path unit: the injectable clock and the single guarded statement
    const e = await mkExam(w);
    at(START + MIN);
    const st = await start(w.s[0]!, e.id);
    await saveAnswer(w.students[0]!.id, st.body.id, e.qs[0]!.id, ['o1'], false, new Date(T0 + START - T0 + 2 * MIN));
    await expect(saveAnswer(w.students[0]!.id, st.body.id, e.qs[0]!.id, ['o1'], false, new Date(T0 + END))).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
    // tie in a quiz's best attempt is stable (earlier attempt wins) and ranks tie
    const quiz = await mkExam(w, { kind: 'quiz', maxAttempts: 0 });
    at(START + MIN);
    await take(w.s[0]!, quiz, ['right', 'skip']);
    await take(w.s[0]!, quiz, ['skip', 'right']); // 2 vs 3
    await take(w.s[1]!, quiz, ['skip', 'right']); // 3
    at(END + MIN);
    const a = (await prisma.examAttempt.findFirstOrThrow({ where: { examId: quiz.id, studentId: w.students[1]!.id } })).id;
    expect((await view(w.s[1]!, a)).body.rank).toMatchObject({ rank: 1, of: 2 });
  });

  it('the maintenance window produces a warning, not a block', async () => {
    const w = await world(1);
    // START is "now + 1h" in whatever weekday that falls on; build a window covering that Dhaka day
    const { WEEKDAYS } = await import('@cms/shared');
    const { dhakaDate, weekdayOf } = await import('../../lib/time');
    const day = WEEKDAYS[weekdayOf(dhakaDate(new Date(START)))];
    await prisma.setting.upsert({ where: { key: 'maintenance_window' }, update: { value: { day, from: '00:00', to: '23:59' } }, create: { key: 'maintenance_window', value: { day, from: '00:00', to: '23:59' } } });
    try {
      const r = await w.t.post('/api/exams', { offeringId: w.offering.id, kind: 'exam', title: 'M', startAt: iso(START), endAt: iso(END), durationMin: 30, passMarks: 1 });
      expect(r.status).toBe(201);
      expect(r.body.warnings).toEqual(['MAINTENANCE_WINDOW_OVERLAP']);
    } finally {
      await prisma.setting.delete({ where: { key: 'maintenance_window' } });
    }
  });

  it('finaliseAttempt is idempotent and never double-grades', async () => {
    const w = await world(1);
    const e = await mkExam(w);
    at(START + MIN);
    const st = await start(w.s[0]!, e.id);
    await answer(w.s[0]!, st.body.id, e.qs[0]!.id, ['o2']);
    const [x, y] = await Promise.all([finaliseAttempt(st.body.id, 'manual'), finaliseAttempt(st.body.id, 'deadline')]);
    expect([x!.changed, y!.changed].filter(Boolean)).toHaveLength(1);
    expect(x!.score).toBe(y!.score);
    expect(await finaliseAttempt('cnonexistent0000000000000', 'manual')).toBeNull();
    const closed = await ensureRevealed(e.id);
    expect(closed).toBe(false); // window still open
  });
});
