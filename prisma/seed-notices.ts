/**
 * Demo NOTICES + NOTIFICATIONS (DEV / demo data only, idempotent):  npm run db:seed:notices
 * Fixed ids (dn-, dnn-, dnf-) so a re-run changes nothing. Adds:
 *  - 9 central notices from the Admin (everyone, students, teachers, one session; normal / important / urgent,
 *    one shown on the landing page, one expiring soon, one scheduled for the future and not yet delivered),
 *  - class-wise notices: every teacher with offerings writes 1 to 2 notices for one of their offerings, every
 *    Section Mentor one for their section,
 *  - recipients resolved like the publish job (07 §3.3), about 60% of them already read,
 *  - notifications for every user: notice_new for each delivered notice plus a mix of other catalogue types
 *    (exam, result, attendance, routine, material, comments...) with a part unread,
 *  - default notification preferences for every user.
 * Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { Prisma, PrismaClient, type NoticePriority } from '@prisma/client';

const HOUR = 3600000;
const DAY = 24 * HOUR;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const pick = <T>(arr: readonly T[], key: string): T => arr[Math.floor(hash(key) * arr.length)]!;
async function chunked<T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }

const PREF_TYPES = [
  'notice_new', 'online_class_scheduled', 'online_class_starting', 'online_class_changed', 'online_class_cancelled', 'recording_new', 'material_new',
  'exam_published', 'exam_starting_soon', 'result_published', 'exam_key_fixed', 'pinned_post', 'reaction', 'comment', 'reply', 'new_message',
  'course_assignment_changed', 'mentor_assigned', 'marked_absent', 'attendance_below_threshold', 'routine_changed', 'class_cancelled',
  'substitute_assigned', 'content_removed', 'warning', 'muted',
];
const STUDENT_NOTIFS: [string, string][] = [
  ['exam_published', 'A new exam has been published for one of your courses.'],
  ['exam_starting_soon', 'Your exam starts in 15 minutes.'],
  ['result_published', 'Your exam result has been published.'],
  ['marked_absent', 'You were marked absent in a class yesterday.'],
  ['attendance_below_threshold', 'Your attendance is below 75% in one course.'],
  ['routine_changed', 'The routine for next week has changed.'],
  ['class_cancelled', 'Tomorrow\'s class has been cancelled.'],
  ['material_new', 'New notes were added to one of your courses.'],
  ['recording_new', 'A new recorded class is available.'],
  ['online_class_scheduled', 'An online class has been scheduled for this week.'],
  ['comment', 'Someone commented on your post.'],
  ['reaction', 'Someone reacted to your post.'],
  ['pinned_post', 'A new pinned post was added.'],
];
const TEACHER_NOTIFS: [string, string][] = [
  ['course_assignment_changed', 'Your course assignment was updated.'],
  ['substitute_assigned', 'You are the substitute teacher for a class tomorrow.'],
  ['routine_changed', 'The routine for next week has changed.'],
  ['comment', 'Someone commented on your post.'],
  ['reaction', 'Someone reacted to your post.'],
  ['pinned_post', 'A new pinned post was added.'],
  ['online_class_starting', 'Your online class starts in 15 minutes.'],
];

interface NoticeDef {
  id: string; authorId: string; scope: 'central' | 'class'; audience: Prisma.InputJsonValue; title: string; body: string;
  priority: NoticePriority; showOnLanding?: boolean; publishAt: Date; publishedAt: Date | null; expiresAt?: Date | null; recipients: string[];
}

export async function seedNotices(prisma: PrismaClient): Promise<{ notices: number; recipients: number; notifications: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-notices is for development data only');

  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
  if (!admin) throw new Error('No Admin found: run npm run db:seed first');
  const users = await prisma.user.findMany({
    where: { status: 'active', role: { in: ['student', 'teacher'] } },
    select: { id: true, role: true, student: { select: { passedOutAt: true, section: { select: { group: { select: { sessionId: true } } } } } } },
    orderBy: { id: 'asc' },
  });
  const students = users.filter((u) => u.role === 'student' && !u.student?.passedOutAt);
  const teachers = users.filter((u) => u.role === 'teacher');
  if (!students.length || !teachers.length) throw new Error('No teachers or students found: run the earlier seeds first');
  const all = [admin.id, ...teachers.map((t) => t.id), ...students.map((s) => s.id)];
  const sessions = await prisma.session.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  const firstSession = sessions[0]?.id;
  const inSession = (sid: string | undefined) => students.filter((s) => s.student?.section.group.sessionId === sid).map((s) => s.id);
  const now = Date.now();

  const defs: NoticeDef[] = [];
  const central = [
    { k: 1, title: 'Welcome to the new academic year', body: 'Classes begin on schedule. Please collect your ID card from the office.', priority: 'normal' as const, to: 'all', ago: 30, landing: true },
    { k: 2, title: 'Mid-term exam schedule published', body: 'The mid-term exam routine is on the exam tab. Please read the instructions carefully.', priority: 'important' as const, to: 'students', ago: 20 },
    { k: 3, title: 'Staff meeting on Sunday', body: 'All teachers must attend the staff meeting in the conference room at 11 am.', priority: 'normal' as const, to: 'teachers', ago: 14 },
    { k: 4, title: 'College closed for national holiday', body: 'The college will remain closed. Classes resume on the next working day.', priority: 'important' as const, to: 'all', ago: 9, landing: true },
    { k: 5, title: 'Fee and form-fill-up deadline', body: 'Students of the first session must submit their forms before the deadline.', priority: 'urgent' as const, to: 'session', ago: 3 },
    { k: 6, title: 'Library rules updated', body: 'Borrowed books must be returned within 14 days.', priority: 'normal' as const, to: 'students', ago: 25 },
    { k: 7, title: 'Urgent: weather alert, classes end at noon', body: 'Because of heavy rain, today\'s classes end at 12 pm. Please go home safely.', priority: 'urgent' as const, to: 'all', ago: 0.2 },
    { k: 8, title: 'Old notice (expired)', body: 'This notice has expired and should not appear in the list.', priority: 'normal' as const, to: 'all', ago: 40, expired: true },
    { k: 9, title: 'Annual sports day (scheduled)', body: 'Sports day is next month. This notice is scheduled for tomorrow.', priority: 'normal' as const, to: 'all', ago: -1 },
  ];
  for (const c of central) {
    const publishAt = new Date(now - c.ago * DAY);
    const future = publishAt.getTime() > now;
    const recipients = future ? [] : c.to === 'all' ? all : c.to === 'students' ? students.map((s) => s.id) : c.to === 'teachers' ? teachers.map((t) => t.id) : inSession(firstSession);
    defs.push({
      id: `dn-c${c.k}`, authorId: admin.id, scope: 'central',
      audience: c.to === 'all' ? { all: true } : c.to === 'session' ? { roles: ['student'], sessionIds: [firstSession ?? ''] } : { roles: [c.to === 'students' ? 'student' : 'teacher'] },
      title: c.title, body: `<p>${c.body}</p>`, priority: c.priority, showOnLanding: !!c.landing, publishAt, publishedAt: future ? null : publishAt,
      expiresAt: c.expired ? new Date(now - 5 * DAY) : c.k === 5 ? new Date(now + 4 * DAY) : null, recipients,
    });
  }

  // ---- class-wise notices ----
  const offerings = await prisma.courseOffering.findMany({
    where: { endedAt: null },
    select: { id: true, teacherId: true, sectionId: true, course: { select: { name: true } }, enrollments: { where: { status: 'active' }, select: { studentId: true } } },
    orderBy: { id: 'asc' },
  });
  const byTeacher = new Map<string, typeof offerings>();
  for (const o of offerings) byTeacher.set(o.teacherId, [...(byTeacher.get(o.teacherId) ?? []), o]);
  const classTitles = [
    (c: string) => ({ t: `${c}: class test next week`, b: 'Prepare chapters covered so far. The test is 20 minutes.', p: 'important' as const }),
    (c: string) => ({ t: `${c}: assignment submission`, b: 'Submit your notebook to me before the weekend.', p: 'normal' as const }),
  ];
  for (const [teacherId, offs] of [...byTeacher.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const n = hash(teacherId + 'n') < 0.5 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const o = offs[Math.floor(hash(teacherId + k) * offs.length)]!;
      const d = classTitles[k]!(o.course.name);
      const publishAt = new Date(now - (2 + Math.floor(hash(teacherId + 'd' + k) * 15)) * DAY);
      defs.push({
        id: `dn-k-${teacherId.slice(-8)}-${k}`, authorId: teacherId, scope: 'class', audience: { offeringIds: [o.id] },
        title: d.t, body: `<p>${d.b}</p>`, priority: d.p, publishAt, publishedAt: publishAt, recipients: [teacherId, ...o.enrollments.map((e) => e.studentId)],
      });
    }
  }
  const mentors = await prisma.section.findMany({ where: { deletedAt: null, mentorTeacherId: { not: null } }, select: { id: true, mentorTeacherId: true, classLevel: true, name: true, students: { where: { passedOutAt: null }, select: { userId: true } } } });
  for (const s of mentors) {
    const publishAt = new Date(now - 6 * DAY);
    defs.push({
      id: `dn-m-${s.id.slice(-8)}`, authorId: s.mentorTeacherId!, scope: 'class', audience: { sectionIds: [s.id] },
      title: `Class ${s.classLevel} ${s.name}: guardian meeting`, body: '<p>Please bring your guardian to the meeting this Sunday after the last period.</p>',
      priority: 'important', publishAt, publishedAt: publishAt, recipients: [s.mentorTeacherId!, ...s.students.map((x) => x.userId)],
    });
  }

  // ---- write notices, recipients, reads, notice_new notifications ----
  await prisma.notice.createMany({
    skipDuplicates: true,
    data: defs.map((d) => ({
      id: d.id, authorId: d.authorId, scope: d.scope, audience: d.audience, title: d.title, bodyHtml: d.body, priority: d.priority,
      showOnLanding: !!d.showOnLanding, publishAt: d.publishAt, publishedAt: d.publishedAt, expiresAt: d.expiresAt ?? null, createdAt: d.publishAt,
    })),
  });
  const recRows: { noticeId: string; userId: string }[] = [];
  const readRows: { noticeId: string; userId: string; readAt: Date }[] = [];
  const notifRows: Prisma.NotificationCreateManyInput[] = [];
  for (const d of defs) {
    for (const uid of d.recipients) {
      recRows.push({ noticeId: d.id, userId: uid });
      const read = uid !== d.authorId && hash(d.id + uid) < (d.priority === 'urgent' ? 0.45 : 0.6) || uid === d.authorId;
      if (read) readRows.push({ noticeId: d.id, userId: uid, readAt: new Date(d.publishAt.getTime() + (1 + Math.floor(hash(uid + d.id) * 40)) * HOUR) });
      if (uid !== d.authorId) {
        notifRows.push({
          id: `dnn-${d.id}-${uid.slice(-8)}`, userId: uid, type: 'notice_new', refType: 'notice', refId: d.id, text: `New notice: ${d.title}`,
          readAt: read ? new Date(d.publishAt.getTime() + HOUR) : null, createdAt: d.publishAt,
        });
      }
    }
  }
  await chunked(recRows, 2000, (c) => prisma.noticeRecipient.createMany({ data: c, skipDuplicates: true }));
  await chunked(readRows, 2000, (c) => prisma.noticeRead.createMany({ data: c, skipDuplicates: true }));

  // ---- other notification types for every user ----
  for (const u of [...students, ...teachers]) {
    const pool = u.role === 'student' ? STUDENT_NOTIFS : TEACHER_NOTIFS;
    const n = 6 + Math.floor(hash(u.id + 'nn') * 8);
    for (let k = 0; k < n; k++) {
      const [type, text] = pick(pool, `${u.id}t${k}`);
      const createdAt = new Date(now - Math.floor(hash(u.id + 'c' + k) * 14 * DAY));
      notifRows.push({ id: `dnf-${u.id.slice(-8)}-${k}`, userId: u.id, type, text, readAt: hash(u.id + 'r' + k) < 0.55 ? new Date(createdAt.getTime() + 3 * HOUR) : null, createdAt });
    }
  }
  await chunked(notifRows, 2000, (c) => prisma.notification.createMany({ data: c, skipDuplicates: true }));

  // ---- default preferences ----
  const prefs = [...students, ...teachers].flatMap((u) => PREF_TYPES.map((type) => ({ userId: u.id, type, email: type !== 'reaction' && type !== 'comment', push: true })));
  await chunked(prefs, 2000, (c) => prisma.notificationPref.createMany({ data: c, skipDuplicates: true }));

  return { notices: defs.length, recipients: recRows.length, notifications: notifRows.length };
}

if (process.argv[1] && /seed-notices\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedNotices(prisma)
    .then((x) => console.log(`Notice demo data: ${x.notices} notices, ${x.recipients} recipients and ${x.notifications} notifications.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
