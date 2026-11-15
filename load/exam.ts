/**
 * OPS-05 exam load: USERS students start the exam within RAMP_S seconds, then save an answer every SAVE_EVERY_S
 * seconds for DURATION_MIN minutes, then submit. Writes test-results/load/exam.json.
 *   npx tsx load/exam.ts                              spec profile: 500 users, 120 s ramp, 20 s saves, 45 min
 *   USERS=500 DURATION_MIN=5 npx tsx load/exam.ts     shorter run (recorded in the summary as durationMin)
 */
import { api, fixture, pct, save, sleep } from './lib';

const USERS = Number(process.env.USERS ?? 500);
const RAMP_S = Number(process.env.RAMP_S ?? 120);
const SAVE_EVERY_S = Number(process.env.SAVE_EVERY_S ?? 20);
const DURATION_MIN = Number(process.env.DURATION_MIN ?? 45);

const saves: number[] = [];
const starts: number[] = [];
const errors: string[] = [];
const err = (what: string, status: number | string) => void errors.push(`${what}:${status}`);

async function student(token: string, examId: string, delayMs: number, endAt: number) {
  await sleep(delayMs);
  let t = performance.now();
  const r = await api(token, 'POST', `/api/exams/${examId}/attempts`).catch(() => null);
  starts.push(performance.now() - t);
  if (!r || ![200, 201].includes(r.status)) return err('start', r?.status ?? 'net');
  const a = (await r.json()) as { id: string; questions: { id: string; options: { id: string }[] }[] };
  let n = 0;
  while (Date.now() < endAt) {
    const q = a.questions[n % a.questions.length]!;
    t = performance.now();
    const s = await api(token, 'PUT', `/api/exams/attempts/${a.id}/answers/${q.id}`, { selectedOptionIds: [q.options[n % 4]!.id], markedForReview: false }).catch(() => null);
    const ms = performance.now() - t;
    if (!s || s.status !== 200) err('save', s?.status ?? 'net');
    else saves.push(ms);
    n++;
    await sleep(SAVE_EVERY_S * 1000 * (0.9 + Math.random() * 0.2));
  }
  const sub = await api(token, 'POST', `/api/exams/attempts/${a.id}/submit`).catch(() => null);
  if (!sub || sub.status !== 200) err('submit', sub?.status ?? 'net');
}

async function main() {
  const f = fixture();
  const users = f.students.slice(0, USERS);
  if (users.length < USERS) throw new Error(`fixture has only ${users.length} students`);
  const endAt = Date.now() + DURATION_MIN * 60_000;
  console.log(`exam load: ${USERS} users, ramp ${RAMP_S}s, save every ${SAVE_EVERY_S}s, ${DURATION_MIN} min`);
  await Promise.all(users.map((u, i) => student(u.token, f.examId, (i / USERS) * RAMP_S * 1000, endAt)));
  const out = {
    virtualUsers: USERS, durationMin: DURATION_MIN, rampSeconds: RAMP_S, saveEverySeconds: SAVE_EVERY_S, saves: saves.length,
    p50SaveMs: pct(saves, 50), p95SaveMs: pct(saves, 95), p99SaveMs: pct(saves, 99), maxSaveMs: saves.reduce((m, x) => Math.max(m, x), 0),
    p95StartMs: pct(starts, 95), errors: errors.length, errorKinds: [...new Set(errors)], ranAt: new Date().toISOString(),
  };
  save('exam.json', out);
  console.log(out);
}
void main();
