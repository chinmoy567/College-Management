/**
 * Demo COMMUNITY / FEED data (DEV / demo data only, idempotent):  npm run db:seed:community
 * Fixed ids (dp-, dcm-) so a re-run changes nothing. Adds:
 *  - 90 posts over the last 5 weeks by the Admin, teachers and students (all 4 tags, links, a held post),
 *  - pinned posts: 2 from the Admin (everyone) and one from every Section Mentor (own section), still active,
 *  - comments (some with one level of replies), reactions on posts and comments,
 *  - PostView rows so only some users still see the pinned posts on top,
 *  - banned words, 3 reports (open / dismissed / actioned) and one warning for the moderation pages.
 * No images or PDFs (they need real files). Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient, type PostTag, type ReactionType } from '@prisma/client';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const POSTS = 90;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const pick = <T>(arr: readonly T[], key: string): T => arr[Math.floor(hash(key) * arr.length)]!;

const TEXTS: Record<PostTag, string[]> = {
  general: [
    'Good morning everyone! Wishing you all a productive week ahead.',
    'Reminder: please keep the classroom clean and bring your ID card every day.',
    'The college library now stays open until 5 pm on weekdays.',
    'Congratulations to all students who took part in the inter-college quiz!',
    'Please check the notice board for the updated routine.',
    'Our canteen has a new menu this week. Let us know what you think!',
  ],
  problem: [
    'I could not understand the last chapter on motion. Can someone explain Newton\'s second law with an example?',
    'Stuck on question 5 of the chemistry practice sheet. Any hints?',
    'How do I balance this redox equation: Fe + Cl2 -> FeCl3?',
    'Can anyone share the method for solving quadratic inequalities quickly?',
    'I keep mixing up "affect" and "effect". Any tricks to remember?',
    'What is the difference between fixed cost and variable cost in accounting?',
  ],
  study: [
    'Study tip: revise for 25 minutes, then rest for 5. It really helps before exams.',
    'Here is a short summary of the Chapter 3 formulas. Please revise before the quiz.',
    'Sharing my notes on the periodic table trends. Hope they help!',
    'Make a mistake log for every test. Review it a day before the next one.',
    'Practice previous year questions every weekend. They show the exam pattern.',
    'Do not leave the essay for the last day. Write one paragraph every day.',
  ],
  event: [
    'Science fair registration is open. Meet your class representative to sign up.',
    'Sports day is coming up. Join the team practice after the last period.',
    'Cultural program rehearsal this Thursday after class. All performers please attend.',
    'Debate club meets on Wednesday in Room 204. New members are welcome.',
    'Blood donation camp at the college gate this Friday morning.',
    'Photography club is planning a campus walk this weekend.',
  ],
};
const TAGS: PostTag[] = ['general', 'problem', 'study', 'event'];
const COMMENTS = [
  'Thank you for sharing this!', 'Very helpful, thanks.', 'I have the same question.', 'Great post.',
  'See the textbook page 45, it explains this well.', 'Can you share more details?', 'I will join, count me in.',
  'Try solving it step by step, it becomes easy.', 'Well said!', 'Noted, thanks for the reminder.',
];
const REPLIES = ['Glad it helped!', 'Yes, exactly.', 'Let us discuss it after class.', 'Thanks, I will check.'];
const REACTIONS: ReactionType[] = ['like', 'like', 'like', 'love', 'haha', 'wow', 'sad'];
const BANNED = ['stupid', 'idiot', 'dumb', 'hate'];

export async function seedCommunity(prisma: PrismaClient): Promise<{ posts: number; comments: number; reactions: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-community is for development data only');

  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
  if (!admin) throw new Error('No Admin found: run npm run db:seed first');
  const teachers = await prisma.user.findMany({ where: { role: 'teacher', status: 'active' }, select: { id: true }, orderBy: { id: 'asc' } });
  const students = await prisma.user.findMany({
    where: { role: 'student', status: 'active', student: { passedOutAt: null } },
    select: { id: true }, orderBy: { id: 'asc' },
  });
  if (!teachers.length || !students.length) throw new Error('No teachers or students found: run the earlier seeds first');
  const everyone = [admin.id, ...teachers.map((t) => t.id), ...students.map((s) => s.id)];
  const now = Date.now();

  // ---- banned words ----
  await prisma.bannedWord.createMany({ data: BANNED.map((word) => ({ word, createdBy: admin.id })), skipDuplicates: true });

  // ---- posts ----
  const posts: { id: string; authorId: string; text: string; tag: PostTag; linkUrl: string | null; createdAt: Date; status: 'published' | 'held' }[] = [];
  for (let i = 1; i <= POSTS; i++) {
    const id = `dp-${i}`;
    const r = hash(id);
    const authorId = r < 0.06 ? admin.id : r < 0.36 ? pick(teachers, id + 'a').id : pick(students, id + 'a').id;
    const tag = pick(TAGS, id + 't');
    const createdAt = new Date(now - Math.floor((i / POSTS) * 35 * DAY) - Math.floor(hash(id + 'h') * 6 * HOUR));
    const held = i === 17;
    posts.push({
      id, authorId, tag, createdAt, status: held ? 'held' : 'published',
      text: held ? 'This is so stupid, I hate the new rule.' : pick(TEXTS[tag], id + 'x'),
      linkUrl: tag === 'study' && hash(id + 'l') < 0.3 ? 'https://www.khanacademy.org/' : null,
    });
  }
  await prisma.post.createMany({ data: posts, skipDuplicates: true });

  // ---- pinned posts (still active) ----
  const sections = await prisma.section.findMany({ where: { deletedAt: null, mentorTeacherId: { not: null } }, select: { id: true, mentorTeacherId: true, classLevel: true, name: true } });
  const pinDays = 7;
  const pinPosts: { id: string; authorId: string; text: string; tag: PostTag; createdAt: Date; pinnedUntil: Date; pinAudience: 'all' | 'section'; pinSectionId: string | null }[] = [];
  const adminPins = [
    { id: 'dp-pin-a1', text: 'Important: the final term exam routine is published. Please check your exam tab.', daysAgo: 2 },
    { id: 'dp-pin-a2', text: 'Welcome to the new semester! Be on time and keep your phone silent in class.', daysAgo: 4 },
  ];
  for (const p of adminPins) {
    const createdAt = new Date(now - p.daysAgo * DAY);
    pinPosts.push({ id: p.id, authorId: admin.id, text: p.text, tag: 'general', createdAt, pinnedUntil: new Date(createdAt.getTime() + pinDays * DAY), pinAudience: 'all', pinSectionId: null });
  }
  for (const s of sections) {
    const createdAt = new Date(now - (1 + Math.floor(hash(s.id) * 4)) * DAY);
    pinPosts.push({
      id: `dp-pin-s-${s.id.slice(-8)}`, authorId: s.mentorTeacherId!, tag: 'event', createdAt,
      text: `Class ${s.classLevel} section ${s.name}: parents meeting next Sunday. Please tell your guardians.`,
      pinnedUntil: new Date(createdAt.getTime() + pinDays * DAY), pinAudience: 'section', pinSectionId: s.id,
    });
  }
  await prisma.post.createMany({ data: pinPosts, skipDuplicates: true });
  const allPostIds = [...posts.map((p) => p.id), ...pinPosts.map((p) => p.id)];
  const postAuthor = new Map<string, string>([...posts, ...pinPosts].map((p) => [p.id, p.authorId]));
  const postTime = new Map<string, number>([...posts, ...pinPosts].map((p) => [p.id, p.createdAt.getTime()]));

  // ---- comments (one level of replies) ----
  const comments: { id: string; postId: string; parentCommentId: string | null; authorId: string; text: string; createdAt: Date }[] = [];
  for (const pid of allPostIds) {
    const n = Math.floor(hash(pid + 'c') * 6); // 0..5
    for (let k = 1; k <= n; k++) {
      const cid = `dcm-${pid.replace(/^dp-/, '')}-${k}`;
      const authorId = pick(everyone, cid + 'a');
      const createdAt = new Date(postTime.get(pid)! + (k * 40 + Math.floor(hash(cid) * 30)) * 60000);
      comments.push({ id: cid, postId: pid, parentCommentId: null, authorId, text: pick(COMMENTS, cid + 't'), createdAt });
      if (hash(cid + 'r') < 0.35) {
        const rid = `${cid}-r`;
        comments.push({ id: rid, postId: pid, parentCommentId: cid, authorId: postAuthor.get(pid)!, text: pick(REPLIES, rid + 't'), createdAt: new Date(createdAt.getTime() + 20 * 60000) });
      }
    }
  }
  for (let i = 0; i < comments.length; i += 1000) await prisma.comment.createMany({ data: comments.slice(i, i + 1000), skipDuplicates: true });

  // ---- reactions (unique per user and post / comment) ----
  const reactions: { userId: string; postId?: string; commentId?: string; type: ReactionType }[] = [];
  for (const pid of allPostIds) {
    const n = 3 + Math.floor(hash(pid + 'rx') * 25);
    for (let k = 0; k < n; k++) reactions.push({ userId: pick(everyone, `${pid}u${k}`), postId: pid, type: pick(REACTIONS, `${pid}t${k}`) });
  }
  for (const c of comments) {
    if (hash(c.id + 'rc') < 0.4) reactions.push({ userId: pick(everyone, c.id + 'ru'), commentId: c.id, type: 'like' });
  }
  const postReactions = reactions.filter((r) => r.postId), commentReactions = reactions.filter((r) => r.commentId);
  for (let i = 0; i < postReactions.length; i += 1000) await prisma.reaction.createMany({ data: postReactions.slice(i, i + 1000), skipDuplicates: true });
  for (let i = 0; i < commentReactions.length; i += 1000) await prisma.reaction.createMany({ data: commentReactions.slice(i, i + 1000), skipDuplicates: true });

  // ---- views: old posts were seen by many; pinned posts only by about half, so the rest still see them on top ----
  const views: { postId: string; userId: string; seenAt: Date }[] = [];
  for (const p of posts) {
    for (let k = 0; k < 8; k++) views.push({ postId: p.id, userId: pick(everyone, `${p.id}v${k}`), seenAt: new Date(p.createdAt.getTime() + HOUR) });
  }
  for (const p of pinPosts) {
    for (const uid of everyone) if (hash(p.id + uid) < 0.4) views.push({ postId: p.id, userId: uid, seenAt: new Date(p.createdAt.getTime() + 2 * HOUR) });
  }
  for (let i = 0; i < views.length; i += 2000) await prisma.postView.createMany({ data: views.slice(i, i + 2000), skipDuplicates: true });

  // ---- moderation: 3 reports and one warning ----
  const reporter = (n: number) => students[n % students.length]!.id;
  const reportsDef = [
    { id: 'dr-1', reporterId: reporter(3), targetId: 'dp-17', reason: 'Rude language', status: 'open' as const },
    { id: 'dr-2', reporterId: reporter(8), targetId: 'dp-30', reason: 'Not related to the college', status: 'dismissed' as const },
    { id: 'dr-3', reporterId: reporter(12), targetId: 'dp-44', reason: 'Bullying a classmate', status: 'actioned' as const },
  ];
  for (const r of reportsDef) {
    const resolved = r.status !== 'open';
    await prisma.report.upsert({
      where: { id: r.id }, update: {},
      create: { id: r.id, reporterId: r.reporterId, targetType: 'post', targetId: r.targetId, reason: r.reason, status: r.status, resolvedBy: resolved ? admin.id : null, resolvedAt: resolved ? new Date(now - 2 * DAY) : null },
    });
  }
  const offender = postAuthor.get('dp-44')!;
  if (!(await prisma.userSanction.findFirst({ where: { relatedReportId: 'dr-3' } }))) {
    await prisma.userSanction.create({ data: { userId: offender, type: 'warn', reason: 'Bullying a classmate in a post', relatedReportId: 'dr-3', createdBy: admin.id, startsAt: new Date(now - 2 * DAY) } });
  }
  return { posts: posts.length + pinPosts.length, comments: comments.length, reactions: reactions.length };
}

if (process.argv[1] && /seed-community\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedCommunity(prisma)
    .then((x) => console.log(`Community demo data: ${x.posts} posts, ${x.comments} comments and ${x.reactions} reactions.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
