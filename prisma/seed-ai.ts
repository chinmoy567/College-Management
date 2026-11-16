/**
 * Demo AI ASSISTANT history (DEV / demo data only, idempotent):  npm run db:seed:ai
 * Fixed ids (dai-, dam-) so a re-run changes nothing. About 45% of the active students get 1 to 4 saved
 * conversations (4 to 10 messages each, study questions with answers) spread over the last 3 weeks, and
 * daily-usage rows (AIUsage) for the days they chatted; some of them chatted today so the "used today" counter shows.
 * No call to the AI provider is made; the answers are canned text. Book Shop data is NOT seeded: a book needs real
 * PDF files in Supabase Storage. Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const MIN = 60000;
const DAY = 24 * 60 * MIN;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function short(s: string): string {
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) { a = (Math.imul(a, 33) ^ s.charCodeAt(i)) >>> 0; b = (Math.imul(b, 31) + s.charCodeAt(i)) >>> 0; }
  return a.toString(36).padStart(7, '0').slice(-7) + b.toString(36).padStart(7, '0').slice(-5);
}
async function chunked<T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }

const TOPICS: { title: string; q: string[]; a: string[] }[] = [
  { title: 'Newton\'s laws of motion', q: ['Can you explain Newton\'s second law simply?', 'Give me an example with numbers.', 'What is the unit of force?', 'How is it different from the first law?'],
    a: ['Newton\'s second law says force equals mass times acceleration (F = ma). A bigger force on the same object gives a bigger acceleration.', 'If a 2 kg box is pushed with 10 N, its acceleration is 10 / 2 = 5 m/s squared.', 'The unit of force is the newton (N). One newton is 1 kg m/s squared.', 'The first law says an object keeps its state of motion unless a force acts on it. The second law tells you how much it accelerates when a force does act.'] },
  { title: 'Balancing chemical equations', q: ['How do I balance Fe + Cl2 -> FeCl3?', 'Why do we need the same atoms on both sides?', 'Can you give me one more to practice?'],
    a: ['Count atoms on each side. Put 2 in front of Fe and 3 in front of Cl2, then 2 in front of FeCl3: 2Fe + 3Cl2 -> 2FeCl3.', 'Matter is not created or destroyed in a reaction, so every atom on the left must appear on the right.', 'Try balancing H2 + O2 -> H2O. Start with the oxygen atoms and then balance the hydrogen.'] },
  { title: 'Essay writing tips', q: ['How do I start an essay for the board exam?', 'How long should the introduction be?', 'Any tips for the conclusion?'],
    a: ['Begin with a clear one-line statement about the topic, then list the points you will discuss in order.', 'Three to four sentences are enough. State the topic and your main idea.', 'Sum up your main points in your own words and end with a short closing thought. Do not add new points.'] },
  { title: 'Fixed and variable cost', q: ['What is the difference between fixed cost and variable cost?', 'Is rent fixed or variable?', 'How do I find total cost?'],
    a: ['Fixed costs stay the same however much you produce, such as rent. Variable costs change with output, such as raw materials.', 'Rent is a fixed cost because it does not change with the amount you produce.', 'Total cost = fixed cost + variable cost.'] },
  { title: 'Quadratic equations', q: ['What is the quadratic formula?', 'When does it have no real roots?', 'Show me a quick example.'],
    a: ['For ax^2 + bx + c = 0, x = (-b ± sqrt(b^2 - 4ac)) / (2a).', 'When the discriminant b^2 - 4ac is negative, there are no real roots.', 'For x^2 - 5x + 6 = 0: a = 1, b = -5, c = 6, so the discriminant is 1 and x = (5 ± 1) / 2, giving x = 3 or x = 2.'] },
  { title: 'Study plan for exams', q: ['Can you make a study plan for next week?', 'How do I avoid forgetting what I studied?'],
    a: ['Split the week by subject: two hard subjects early in the day, one lighter subject in the evening, and a short revision on the last day. Rest for 5 minutes after every 25 minutes of study.', 'Revise after one day, after one week and before the exam. Writing short notes or testing yourself helps more than re-reading.'] },
];

export async function seedAi(prisma: PrismaClient): Promise<{ students: number; conversations: number; messages: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-ai is for development data only');

  const students = await prisma.studentProfile.findMany({ where: { passedOutAt: null, user: { status: 'active' } }, select: { userId: true }, orderBy: { userId: 'asc' } });
  if (!students.length) throw new Error('No students found: run the earlier seeds first');
  const now = Date.now();
  const dhakaDate = (ms: number) => new Date(new Date(ms + 6 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z'); // Asia/Dhaka calendar day as a date-only value

  const convs: { id: string; studentId: string; title: string; createdAt: Date; updatedAt: Date }[] = [];
  const msgs: { id: string; conversationId: string; role: 'user' | 'assistant'; content: string; tokens: number; createdAt: Date }[] = [];
  const usage = new Map<string, { studentId: string; date: Date; messageCount: number }>();
  let active = 0;

  for (const st of students) {
    if (hash(st.userId + 'ai') > 0.45) continue;
    active++;
    const nConv = 1 + Math.floor(hash(st.userId + 'nc') * 4);
    for (let c = 0; c < nConv; c++) {
      const topic = TOPICS[Math.floor(hash(`${st.userId}t${c}`) * TOPICS.length)]!;
      const id = `dai-${short(st.userId)}-${c}`;
      const start = now - Math.floor(hash(`${st.userId}d${c}`) * 21 * DAY) - 10 * MIN;
      const pairs = Math.min(topic.q.length, 2 + Math.floor(hash(`${st.userId}p${c}`) * 4));
      let t = start;
      for (let k = 0; k < pairs; k++) {
        t += 2 * MIN;
        msgs.push({ id: `dam-${short(id)}-${k}u`, conversationId: id, role: 'user', content: topic.q[k]!, tokens: 20 + Math.floor(hash(id + k) * 30), createdAt: new Date(t) });
        t += 1 * MIN;
        msgs.push({ id: `dam-${short(id)}-${k}a`, conversationId: id, role: 'assistant', content: topic.a[k]!, tokens: 80 + Math.floor(hash(id + k + 'a') * 150), createdAt: new Date(t) });
      }
      convs.push({ id, studentId: st.userId, title: topic.title, createdAt: new Date(start), updatedAt: new Date(t) });
      const day = dhakaDate(start);
      const key = `${st.userId}|${day.toISOString()}`;
      const u = usage.get(key) ?? { studentId: st.userId, date: day, messageCount: 0 };
      u.messageCount += pairs;
      usage.set(key, u);
    }
  }

  await chunked(convs, 1000, (c) => prisma.aIConversation.createMany({ data: c, skipDuplicates: true }));
  await chunked(msgs, 2000, (c) => prisma.aIMessage.createMany({ data: c, skipDuplicates: true }));
  await chunked([...usage.values()], 2000, (c) => prisma.aIUsage.createMany({ data: c, skipDuplicates: true }));
  return { students: active, conversations: convs.length, messages: msgs.length };
}

if (process.argv[1] && /seed-ai\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedAi(prisma)
    .then((x) => console.log(`AI demo data: ${x.students} students, ${x.conversations} conversations and ${x.messages} messages.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
