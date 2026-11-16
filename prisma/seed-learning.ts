/**
 * Demo LEARNING CONTENT (DEV / demo data only, idempotent):  npm run db:seed:learning
 * Fixed ids (dol-, doj-, drc-, dmt-) so a re-run changes nothing. For every active course offering it adds:
 *  - 5 online classes by the offering's teacher: 2 ended (with student join clicks), 1 starting soon,
 *    1 upcoming, 1 cancelled (Meet / Jitsi / other links),
 *  - 3 recorded classes (YouTube links, linked to a chapter when the course has one) with watch progress,
 *  - 2 notes (link-only materials, scope offering).
 * Plus: one section note from every Section Mentor, one group note and one college-wide free recording from the Admin.
 * Files are NOT created (they would have to be uploaded to Supabase Storage): notes use links, and previous-year
 * questions are not seeded because they need PDF or image files. Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient, type MeetPlatform, type OnlineClassStatus } from '@prisma/client';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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
  return a.toString(36).padStart(7, '0').slice(-7) + b.toString(36).padStart(7, '0').slice(-5);
}
async function chunked<T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }

const YT_IDS = ['PkZNo7MFNFg', 'rfscVS0vtbw', 'kqtD5dpn9C8', 'zOjov-2OZ0E', '8jLOx1hD3_o', 'Z1Yd7upQsXY'];
const PLATFORMS: MeetPlatform[] = ['meet', 'jitsi', 'other'];
const joinUrl = (p: MeetPlatform, key: string) =>
  p === 'meet' ? `https://meet.google.com/${key.slice(0, 3)}-${key.slice(3, 7)}-${key.slice(7, 10)}` : p === 'jitsi' ? `https://meet.jit.si/college-${key}` : `https://example.com/class/${key}`;

export async function seedLearning(prisma: PrismaClient): Promise<{ offerings: number; onlineClasses: number; recordings: number; materials: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-learning is for development data only');

  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
  if (!admin) throw new Error('No Admin found: run npm run db:seed first');
  const offerings = await prisma.courseOffering.findMany({
    where: { endedAt: null, enrollments: { some: { status: 'active' } } },
    select: { id: true, teacherId: true, courseId: true, sectionId: true, course: { select: { name: true } }, enrollments: { where: { status: 'active' }, select: { studentId: true } } },
    orderBy: { id: 'asc' },
  });
  if (!offerings.length) throw new Error('No offerings with students found: run the earlier seeds first');
  const chapters = await prisma.chapter.findMany({ select: { id: true, courseId: true, name: true }, orderBy: { order: 'asc' } });
  const chaptersOf = new Map<string, { id: string; name: string }[]>();
  for (const c of chapters) chaptersOf.set(c.courseId, [...(chaptersOf.get(c.courseId) ?? []), c]);
  const now = Date.now();

  const classes: { id: string; teacherId: string; title: string; topic: string; description: string; startAt: Date; durationMin: number; platform: MeetPlatform; joinUrl: string; status: OnlineClassStatus; createdAt: Date }[] = [];
  const classOfferings: { onlineClassId: string; courseOfferingId: string }[] = [];
  const joins: { id: string; onlineClassId: string; studentId: string; clickedJoinAt: Date }[] = [];
  const recordings: { id: string; courseId: string; courseOfferingId: string | null; chapterId: string | null; title: string; description: string; videoSource: 'youtube'; url: string; videoId: string; visibility: 'section' | 'college'; createdBy: string; createdAt: Date }[] = [];
  const progress: { recordedClassId: string; studentId: string; firstOpenedAt: Date; lastOpenedAt: Date }[] = [];
  const materials: { id: string; scope: 'offering' | 'section' | 'group' | 'college'; courseId: string | null; courseOfferingId: string | null; sectionId: string | null; groupId: string | null; chapterId: string | null; title: string; description: string; linkUrl: string; createdBy: string; createdAt: Date }[] = [];

  const plan: { key: string; status: OnlineClassStatus; startOffsetMs: number }[] = [
    { key: 'p1', status: 'ended', startOffsetMs: -9 * DAY },
    { key: 'p2', status: 'ended', startOffsetMs: -3 * DAY },
    { key: 'soon', status: 'scheduled', startOffsetMs: 10 * MIN },
    { key: 'up', status: 'scheduled', startOffsetMs: 2 * DAY },
    { key: 'cx', status: 'cancelled', startOffsetMs: 4 * DAY },
  ];

  for (const o of offerings) {
    const os = short(o.id);
    const cname = o.course.name;
    const chs = chaptersOf.get(o.courseId) ?? [];
    const students = o.enrollments.map((e) => e.studentId);
    for (const p of plan) {
      const id = `dol-${os}-${p.key}`;
      const platform = PLATFORMS[Math.floor(hash(id) * 3)]!;
      const startAt = new Date(now + p.startOffsetMs);
      classes.push({
        id, teacherId: o.teacherId, title: `${cname}: ${p.key === 'cx' ? 'extra revision class' : p.key.startsWith('p') ? `lecture ${p.key.slice(1)}` : 'live lesson'}`,
        topic: chs.length ? chs[Math.floor(hash(id + 'c') * chs.length)]!.name : 'Revision', description: 'Online class for the section. Join with the link below.',
        startAt, durationMin: 45 + Math.floor(hash(id + 'd') * 3) * 15, platform, joinUrl: joinUrl(platform, short(id)), status: p.status, createdAt: new Date(startAt.getTime() - 3 * DAY),
      });
      classOfferings.push({ onlineClassId: id, courseOfferingId: o.id });
      if (p.status === 'ended') {
        students.forEach((sid, i) => {
          if (hash(id + sid) < 0.72) joins.push({ id: `doj-${short(id)}-${i}`, onlineClassId: id, studentId: sid, clickedJoinAt: new Date(startAt.getTime() + Math.floor(hash(sid + id) * 12) * MIN) });
        });
      }
    }
    for (let r = 1; r <= 3; r++) {
      const id = `drc-${os}-${r}`;
      const vid = YT_IDS[Math.floor(hash(id) * YT_IDS.length)]!;
      const createdAt = new Date(now - (r * 4 + Math.floor(hash(id + 'd') * 3)) * DAY);
      const ch = chs.length ? chs[(r - 1) % chs.length]! : null;
      recordings.push({
        id, courseId: o.courseId, courseOfferingId: o.id, chapterId: ch?.id ?? null, title: `${cname}: recorded lecture ${r}${ch ? ` (${ch.name})` : ''}`,
        description: 'Recorded class. Watch before the next lesson.', videoSource: 'youtube', url: `https://www.youtube.com/watch?v=${vid}`, videoId: vid, visibility: 'section', createdBy: o.teacherId, createdAt,
      });
      for (const sid of students) {
        if (hash(id + sid) < 0.6 - r * 0.1) {
          const first = new Date(createdAt.getTime() + (1 + Math.floor(hash(sid + id) * 48)) * HOUR);
          progress.push({ recordedClassId: id, studentId: sid, firstOpenedAt: first, lastOpenedAt: new Date(first.getTime() + Math.floor(hash(id + sid + 'l') * 3) * DAY) });
        }
      }
    }
    for (let m = 1; m <= 2; m++) {
      const id = `dmt-${os}-${m}`;
      const ch = chs.length ? chs[(m - 1) % chs.length]! : null;
      materials.push({
        id, scope: 'offering', courseId: o.courseId, courseOfferingId: o.id, sectionId: null, groupId: null, chapterId: ch?.id ?? null,
        title: `${cname}: ${m === 1 ? 'chapter notes' : 'practice problems'}`, description: 'Study material for the section.',
        linkUrl: m === 1 ? 'https://en.wikipedia.org/wiki/Main_Page' : 'https://www.khanacademy.org/', createdBy: o.teacherId, createdAt: new Date(now - (m * 6) * DAY),
      });
    }
  }

  // mentors' section notes, Admin group note and college-wide free recording
  const sections = await prisma.section.findMany({ where: { deletedAt: null }, select: { id: true, groupId: true, classLevel: true, name: true, mentorTeacherId: true }, orderBy: { id: 'asc' } });
  for (const s of sections) {
    if (!s.mentorTeacherId) continue;
    materials.push({
      id: `dmt-sec-${short(s.id)}`, scope: 'section', courseId: null, courseOfferingId: null, sectionId: s.id, groupId: null, chapterId: null,
      title: `Class ${s.classLevel} ${s.name}: exam preparation guide`, description: 'From your Section Mentor.', linkUrl: 'https://www.khanacademy.org/', createdBy: s.mentorTeacherId, createdAt: new Date(now - 5 * DAY),
    });
  }
  const groups = [...new Set(sections.map((s) => s.groupId))].sort();
  for (const gid of groups) {
    materials.push({
      id: `dmt-grp-${short(gid)}`, scope: 'group', courseId: null, courseOfferingId: null, sectionId: null, groupId: gid, chapterId: null,
      title: 'Group study timetable and tips', description: 'From the Admin.', linkUrl: 'https://en.wikipedia.org/wiki/Study_skills', createdBy: admin.id, createdAt: new Date(now - 8 * DAY),
    });
  }
  materials.push({ id: 'dmt-college-1', scope: 'college', courseId: null, courseOfferingId: null, sectionId: null, groupId: null, chapterId: null, title: 'Free reading list for all students', description: 'Open to everyone.', linkUrl: 'https://www.gutenberg.org/', createdBy: admin.id, createdAt: new Date(now - 12 * DAY) });
  const anyCourse = offerings[0]!;
  recordings.push({
    id: 'drc-college-1', courseId: anyCourse.courseId, courseOfferingId: null, chapterId: null, title: 'How to study effectively (free for all)', description: 'College-wide free recording.',
    videoSource: 'youtube', url: `https://www.youtube.com/watch?v=${YT_IDS[0]}`, videoId: YT_IDS[0]!, visibility: 'college', createdBy: admin.id, createdAt: new Date(now - 10 * DAY),
  });

  await chunked(classes, 1000, (c) => prisma.onlineClass.createMany({ data: c, skipDuplicates: true }));
  await chunked(classOfferings, 2000, (c) => prisma.onlineClassOffering.createMany({ data: c, skipDuplicates: true }));
  await chunked(joins, 2000, (c) => prisma.onlineClassJoin.createMany({ data: c, skipDuplicates: true }));
  await chunked(recordings, 1000, (c) => prisma.recordedClass.createMany({ data: c, skipDuplicates: true }));
  await chunked(progress, 2000, (c) => prisma.recordingProgress.createMany({ data: c, skipDuplicates: true }));
  await chunked(materials, 1000, (c) => prisma.material.createMany({ data: c, skipDuplicates: true }));
  return { offerings: offerings.length, onlineClasses: classes.length, recordings: recordings.length, materials: materials.length };
}

if (process.argv[1] && /seed-learning\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedLearning(prisma)
    .then((x) => console.log(`Learning demo data: ${x.offerings} offerings, ${x.onlineClasses} online classes, ${x.recordings} recordings and ${x.materials} notes.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
