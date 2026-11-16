/**
 * Demo PEOPLE / CALENDAR extras (DEV / demo data only, idempotent):  npm run db:seed:people
 *  - a Section Mentor for every active section that has none (one section per mentor, so a teacher who
 *    teaches in that section and is not yet a mentor is chosen),
 *  - college holidays and one special day in the demo date range (fixed ids, so a re-run changes nothing),
 *  - missing bio / designation on teachers and bio / DOB / address / guardian on students (never overwrites).
 * Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const DAY = 24 * 3600000;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Date-only (UTC midnight) n days from today. */
function dayFromToday(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + n * DAY);
}

const DESIGNATIONS = ['Lecturer', 'Assistant Professor', 'Senior Lecturer', 'Associate Professor'];
const GUARDIANS = ['Abdul Karim', 'Rahima Begum', 'Mizanur Rahman', 'Shirin Akter', 'Kamal Hossain', 'Nasima Khatun', 'Jahangir Alam', 'Salma Parvin'];
const AREAS = ['Mirpur', 'Dhanmondi', 'Uttara', 'Mohammadpur', 'Banani', 'Tejgaon', 'Gulshan', 'Rampura'];

export async function seedPeopleExtra(prisma: PrismaClient): Promise<{ mentors: number; holidays: number; teachers: number; students: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-people-extra is for development data only');

  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
  if (!admin) throw new Error('No Admin found: run npm run db:seed first');

  // ---- mentors ----
  const taken = new Set((await prisma.section.findMany({ where: { mentorTeacherId: { not: null } }, select: { mentorTeacherId: true } })).map((s) => s.mentorTeacherId!));
  const sections = await prisma.section.findMany({
    where: { deletedAt: null, mentorTeacherId: null },
    include: { offerings: { where: { endedAt: null }, select: { teacherId: true } } },
    orderBy: { id: 'asc' },
  });
  let mentors = 0;
  for (const sec of sections) {
    const counts = new Map<string, number>();
    for (const o of sec.offerings) counts.set(o.teacherId, (counts.get(o.teacherId) ?? 0) + 1);
    const pick = [...counts.entries()].filter(([t]) => !taken.has(t)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (!pick) continue;
    await prisma.section.update({ where: { id: sec.id }, data: { mentorTeacherId: pick } });
    taken.add(pick);
    mentors++;
  }

  // ---- holidays and a special day (fixed ids) ----
  const holidays = [
    { id: 'demo-hol-1', from: -30, to: -29, title: 'Mid-term break' },
    { id: 'demo-hol-2', from: -16, to: -16, title: 'National Mourning Day' },
    { id: 'demo-hol-3', from: 9, to: 11, title: 'Eid vacation' },
    { id: 'demo-hol-4', from: 25, to: 25, title: 'Victory Day' },
  ];
  let holidayCount = 0;
  for (const h of holidays) {
    const r = await prisma.holiday.upsert({
      where: { id: h.id }, update: {},
      create: { id: h.id, startDate: dayFromToday(h.from), endDate: dayFromToday(h.to), title: h.title, createdBy: admin.id },
    });
    if (r) holidayCount++;
  }
  const sdDate = dayFromToday(6);
  const sdExists = await prisma.specialDay.findFirst({ where: { date: sdDate, sessionId: null } });
  if (!sdExists) await prisma.specialDay.create({ data: { date: sdDate, title: 'Science Fair day (short periods)', sessionId: null, periodIds: [], createdBy: admin.id } });

  // ---- profile gaps (never overwrite) ----
  const teachers = await prisma.teacherProfile.findMany({ where: { OR: [{ bio: null }, { designation: null }] }, select: { userId: true, name: true, subjects: true, bio: true, designation: true } });
  for (const t of teachers) {
    await prisma.teacherProfile.update({
      where: { userId: t.userId },
      data: {
        designation: t.designation ?? DESIGNATIONS[Math.floor(hash(t.userId) * DESIGNATIONS.length)]!,
        bio: t.bio ?? `${t.name} teaches ${t.subjects.join(', ') || 'at this college'} and enjoys helping students prepare for their exams.`,
      },
    });
  }
  const students = await prisma.studentProfile.findMany({
    where: { passedOutAt: null, OR: [{ bio: null }, { dob: null }, { address: null }, { guardianName: null }] },
    select: { userId: true, bio: true, dob: true, address: true, guardianName: true, guardianContact: true, section: { select: { classLevel: true } } },
  });
  for (const s of students) {
    const h = hash(s.userId);
    const age = s.section.classLevel === 12 ? 17 : 16; // up to 18, may be minors (client decision)
    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - age, Math.floor(h * 12), 1 + Math.floor(hash(s.userId + 'd') * 27)));
    await prisma.studentProfile.update({
      where: { userId: s.userId },
      data: {
        bio: s.bio ?? 'Studying hard and enjoying college life.',
        dob: s.dob ?? dob,
        address: s.address ?? `House ${1 + Math.floor(h * 90)}, ${AREAS[Math.floor(hash(s.userId + 'a') * AREAS.length)]}, Dhaka`,
        guardianName: s.guardianName ?? GUARDIANS[Math.floor(hash(s.userId + 'g') * GUARDIANS.length)]!,
        guardianContact: s.guardianContact ?? `017${String(10000000 + Math.floor(h * 89999999)).slice(0, 8)}`,
      },
    });
  }
  return { mentors, holidays: holidayCount, teachers: teachers.length, students: students.length };
}

if (process.argv[1] && /seed-people-extra\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedPeopleExtra(prisma)
    .then((x) => console.log(`People extras: ${x.mentors} mentors assigned, ${x.holidays} holidays, ${x.teachers} teacher and ${x.students} student profiles completed.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
