/**
 * Demo CHAT data (DEV / demo data only, idempotent):  npm run db:seed:chat
 * Adds, with fixed ids so a re-run changes nothing (existing conversations are reused, never duplicated):
 *  - one section chat per section (active students + mentor + teachers of its offerings), about 45 messages,
 *  - one group chat per session-group (active students + mentors of its sections), about 35 messages,
 *  - direct chats: student-student (same section), teacher-student (a teacher and one of their students),
 *    teacher-teacher and Admin-teacher, 4 to 14 messages each,
 *  - last-read pointers that differ per member, so unread counts and "seen" status show real numbers.
 * The Admin is not in group or section chats (PRD §2.1). Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient, type ConversationType } from '@prisma/client';

const MIN = 60000;
const DAY = 24 * 60 * MIN;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Short stable id part (ids are at most 40 characters). */
function short(s: string): string {
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) { a = (Math.imul(a, 33) ^ s.charCodeAt(i)) >>> 0; b = (Math.imul(b, 31) + s.charCodeAt(i)) >>> 0; }
  return a.toString(36).padStart(7, '0').slice(-7) + b.toString(36).padStart(7, '0').slice(-7);
}
const pick = <T>(arr: readonly T[], key: string): T => arr[Math.floor(hash(key) * arr.length)]!;
async function chunked<T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }

const CLASS_MSGS = [
  'Is there any class tomorrow?', 'Yes, the routine says first period at 9 am.', 'Did anyone finish the homework?', 'Which chapter is the test on?',
  'Chapter 3 and 4, I think.', 'Can someone share the notes from today?', 'I will upload them tonight.', 'Thanks a lot!', 'Please be on time tomorrow.',
  'The exam routine is out, check the exam tab.', 'Good luck everyone!', 'Who is joining the library after class?', 'I missed the last class, what did we cover?',
  'We finished the first half of the chapter.', 'Please keep the chat respectful.', 'Sir said the test is postponed to next week.', 'Okay, thanks for the update.',
];
const TEACHER_MSGS = [
  'Please revise the last chapter before the next class.', 'The quiz will be open from tomorrow morning.', 'Submit your notebooks by Thursday.',
  'Good work in the last test, keep it up.', 'Ask me here if you have any doubt.',
];
const DIRECT_MSGS = [
  'Hi! Do you have a minute?', 'Sure, what is it?', 'Can you explain the last topic again?', 'Of course. Let us meet in the library after class.',
  'Thank you so much.', 'No problem!', 'Did you see the new notice?', 'Yes, I did. The deadline is close.', 'See you tomorrow then.', 'Okay, bye!',
  'Could you send me the question paper?', 'Sending it now.', 'Got it, thanks.',
];

interface Conv { key: string; type: ConversationType; refId: string | null; directKey: string | null; members: string[]; senders: string[]; teacherIds: Set<string>; count: number; spanDays: number; pool: string[] }

export async function seedChat(prisma: PrismaClient): Promise<{ conversations: number; messages: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-chat is for development data only');

  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
  if (!admin) throw new Error('No Admin found: run npm run db:seed first');
  const sections = await prisma.section.findMany({
    where: { deletedAt: null },
    select: {
      id: true, groupId: true, mentorTeacherId: true,
      students: { where: { passedOutAt: null, user: { status: 'active' } }, select: { userId: true }, orderBy: { userId: 'asc' } },
      offerings: { where: { endedAt: null }, select: { teacherId: true } },
    },
    orderBy: { id: 'asc' },
  });
  const teacherIds = (await prisma.user.findMany({ where: { role: 'teacher', status: 'active' }, select: { id: true }, orderBy: { id: 'asc' } })).map((t) => t.id);
  if (!sections.length || !teacherIds.length) throw new Error('No sections or teachers found: run the earlier seeds first');

  const convs: Conv[] = [];
  const groupMembers = new Map<string, { students: Set<string>; mentors: Set<string> }>();
  for (const s of sections) {
    const students = s.students.map((x) => x.userId);
    const teachers = new Set<string>([...s.offerings.map((o) => o.teacherId), ...(s.mentorTeacherId ? [s.mentorTeacherId] : [])]);
    if (students.length) {
      convs.push({ key: `dcv-s-${s.id.slice(-10)}`, type: 'section', refId: s.id, directKey: null, members: [...students, ...teachers], senders: [...students, ...teachers], teacherIds: teachers, count: 45, spanDays: 21, pool: CLASS_MSGS });
    }
    const g = groupMembers.get(s.groupId) ?? { students: new Set<string>(), mentors: new Set<string>() };
    students.forEach((u) => g.students.add(u));
    if (s.mentorTeacherId) g.mentors.add(s.mentorTeacherId);
    groupMembers.set(s.groupId, g);
  }
  for (const [gid, g] of [...groupMembers.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!g.students.size) continue;
    const members = [...g.students, ...g.mentors];
    convs.push({ key: `dcv-g-${gid.slice(-10)}`, type: 'group', refId: gid, directKey: null, members, senders: members, teacherIds: g.mentors, count: 35, spanDays: 21, pool: CLASS_MSGS });
  }

  // ---- direct chats ----
  const directs = new Map<string, [string, string]>();
  const addDirect = (a: string, b: string) => { if (a !== b) { const [lo, hi] = a < b ? [a, b] : [b, a]; directs.set(`${lo}:${hi}`, [lo, hi]); } };
  for (const s of sections) {
    const st = s.students.map((x) => x.userId);
    for (let i = 0; i + 1 < st.length && i < 8; i += 2) addDirect(st[i]!, st[(i + 1 + Math.floor(hash(st[i]! + 'p') * (st.length - 1 - i))) % st.length]!);
    for (let i = 0; i < Math.min(6, st.length); i++) {
      const t = s.offerings.length ? s.offerings[Math.floor(hash(st[i]! + 't') * s.offerings.length)]!.teacherId : null;
      if (t) addDirect(t, st[Math.floor(hash(st[i]! + 'q') * st.length)]!);
    }
  }
  for (let i = 0; i + 1 < teacherIds.length; i += 3) addDirect(teacherIds[i]!, teacherIds[i + 1]!);
  for (let i = 0; i < Math.min(4, teacherIds.length); i++) addDirect(admin.id, teacherIds[i]!);
  const teacherSet = new Set([...teacherIds, admin.id]);
  for (const [dk, [a, b]] of [...directs.entries()].sort()) {
        convs.push({ key: `dcv-d-${short(dk)}`, type: 'direct', refId: null, directKey: dk, members: [a, b], senders: [a, b], teacherIds: new Set([a, b].filter((x) => teacherSet.has(x))), count: 4 + Math.floor(hash(dk) * 11), spanDays: 14, pool: DIRECT_MSGS });
  }

  // ---- create conversations (reuse existing ones), messages, members ----
  const now = Date.now();
  let messageTotal = 0;
  const msgRows: { id: string; conversationId: string; senderId: string; text: string; createdAt: Date }[] = [];
  const memberRows: { conversationId: string; userId: string; joinedAt: Date; lastReadMessageId: string | null }[] = [];
  const convUpdates: { id: string; lastMessageAt: Date }[] = [];

  for (const c of convs) {
    const existing = c.directKey
      ? await prisma.conversation.findUnique({ where: { directKey: c.directKey }, select: { id: true } })
      : await prisma.conversation.findFirst({ where: { type: c.type, refId: c.refId }, select: { id: true } });
    const id = existing?.id ?? c.key;
    if (!existing) await prisma.conversation.create({ data: { id, type: c.type, refId: c.refId, directKey: c.directKey, createdAt: new Date(now - c.spanDays * DAY) } });
    if (existing && (await prisma.message.count({ where: { conversationId: id } })) > 0 && !id.startsWith('dcv-')) continue; // a real conversation: leave it alone

    const ids: string[] = [];
    let t = now - c.spanDays * DAY;
    for (let k = 0; k < c.count; k++) {
      t += Math.floor((c.spanDays * DAY / c.count) * (0.4 + hash(`${id}g${k}`) * 1.2));
      if (t > now - 5 * MIN) t = now - (c.count - k) * 7 * MIN;
      const sender = pick(c.senders, `${id}s${k}`);
      const text = c.teacherIds.has(sender) && c.type !== 'direct' ? pick(TEACHER_MSGS, `${id}m${k}`) : pick(c.pool, `${id}m${k}`);
      const mid = `dmg-${id.slice(-12)}-${k}`;
      ids.push(mid);
      msgRows.push({ id: mid, conversationId: id, senderId: sender, text, createdAt: new Date(t) });
    }
    messageTotal += c.count;
    convUpdates.push({ id, lastMessageAt: new Date(t) });
    for (const u of new Set(c.members)) {
      const r = hash(id + u);
      const readIdx = r < 0.5 ? c.count - 1 : r < 0.8 ? Math.max(0, c.count - 1 - Math.floor(hash(u + id) * 6)) : Math.floor(hash(u + id + 'x') * c.count);
      memberRows.push({ conversationId: id, userId: u, joinedAt: new Date(now - c.spanDays * DAY), lastReadMessageId: ids[readIdx]! });
    }
  }
  await chunked(msgRows, 2000, (r) => prisma.message.createMany({ data: r, skipDuplicates: true }));
  await chunked(memberRows, 2000, (r) => prisma.conversationMember.createMany({ data: r, skipDuplicates: true }));
  for (const u of convUpdates) await prisma.conversation.update({ where: { id: u.id }, data: { lastMessageAt: u.lastMessageAt } });
  return { conversations: convs.length, messages: messageTotal };
}

if (process.argv[1] && /seed-chat\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedChat(prisma)
    .then((x) => console.log(`Chat demo data: ${x.conversations} conversations and ${x.messages} messages.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
