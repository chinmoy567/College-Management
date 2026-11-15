/**
 * Fills the demo DB so that each of 2025–26 (Class 12) and 2026–27 (Class 11) has Science A, Commerce A and Arts A with
 * exactly 30 students each; every new student gets a unique password. Class 12 sections get the same HSC course offerings
 * as Class 11 and all their students are enrolled. Writes ../student_id_pass.txt (plaintext passwords: never commit it).
 * Idempotent: existing users are kept, and passwords already written to the file are re-used.
 * Run: npx tsx prisma/seed-students-90.ts   (DEV / demo data only)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { generatePassword } from '../apps/api/src/lib/passwordGen';

const DEMO_PASSWORD = 'Demo@12345';
const FILE = path.resolve(__dirname, '..', 'student_id_pass.txt');
const PER_SECTION = 30;

const FIRST = ['Arif', 'Rafiq', 'Sabbir', 'Tanvir', 'Imran', 'Shakib', 'Mehedi', 'Nayeem', 'Rakib', 'Zahid',
  'Fahim', 'Tareq', 'Sohel', 'Jamil', 'Parvez', 'Ashik', 'Mahfuz', 'Raihan', 'Siam', 'Hridoy',
  'Nusrat', 'Farzana', 'Sadia', 'Tasnim', 'Mim', 'Riya', 'Afrin', 'Jannat', 'Sumaiya', 'Ishrat',
  'Mou', 'Tania', 'Lamia', 'Nabila', 'Pritha', 'Shirin', 'Anika', 'Rubaiya', 'Maliha', 'Samira'];
const LAST = ['Ahmed', 'Hossain', 'Rahman', 'Islam', 'Khan', 'Chowdhury', 'Sarkar', 'Mia', 'Akter', 'Begum', 'Uddin', 'Talukder'];
const FATHER = ['Abdul', 'Nurul', 'Kamal', 'Jahangir', 'Shafiqul', 'Anwar', 'Mostafa', 'Habibur'];
const TOWN = ['Mirpur, Dhaka', 'Uttara, Dhaka', 'Mohammadpur, Dhaka', 'Dhanmondi, Dhaka', 'Savar, Dhaka', 'Tongi, Gazipur'];

type G = 'science' | 'commerce' | 'arts' | 'common';
const SUBJECTS: [string, G, string | null, boolean][] = [ // [base, group, teacher loginId, optional]
  ['BAN', 'common', 'T-0010', false], ['ENG', 'common', 'T-0002', false],
  ['PHY', 'science', 'T-0001', false], ['CHE', 'science', 'T-0001', false], ['BIO', 'science', 'T-0004', false],
  ['HM', 'science', 'T-0005', false], ['AGR', 'science', 'T-0021', true],
  ['ACC', 'commerce', 'T-0003', false], ['BO', 'commerce', 'T-0006', false], ['FB', 'commerce', 'T-0007', false],
  ['PMM', 'commerce', 'T-0008', false], ['STA', 'commerce', 'T-0009', false],
  ['HIS', 'arts', 'T-0011', false], ['ISH', 'arts', 'T-0016', false], ['IST', 'arts', 'T-0017', false],
  ['GEO', 'arts', 'T-0012', false], ['CIV', 'arts', 'T-0013', false], ['ECO', 'arts', 'T-0014', false],
  ['SOC', 'arts', 'T-0015', false], ['SWK', 'arts', 'T-0019', false], ['LOG', 'arts', 'T-0018', false],
  ['PSY', 'arts', 'T-0020', false],
];
const BASES: Record<'science' | 'commerce' | 'arts', string[]> = {
  science: ['BAN', 'ENG', 'PHY', 'CHE', 'BIO', 'HM', 'AGR'],
  commerce: ['BAN', 'ENG', 'ACC', 'BO', 'FB', 'PMM', 'STA'],
  arts: ['BAN', 'ENG', 'HIS', 'ISH', 'IST', 'GEO', 'CIV', 'ECO', 'SOC', 'SWK', 'LOG', 'PSY'],
};

const TARGETS: { session: string; classLevel: 11 | 12; year: string; first: number }[] = [
  { session: '2025–26', classLevel: 12, year: '2025', first: 1 },
  { session: '2026–27', classLevel: 11, year: '2026', first: 61 }, // S-2026-0001..0060 already belong to the demo students
];
const GROUPS = ['science', 'commerce', 'arts'] as const;

function readOldPasswords(): Map<string, string> {
  const m = new Map<string, string>();
  if (!fs.existsSync(FILE)) return m;
  for (const line of fs.readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const c = line.split('|').map((s) => s.trim());
    if (/^S-\d{4}-\d{4}$/.test(c[0] ?? '') && c[1]) m.set(c[0]!, c[1]);
  }
  return m;
}

async function main() {
  const prisma = new PrismaClient();
  const old = readOldPasswords(); // also receives passwords generated in this run
  const rows: string[][] = [];
  let created = 0, offeringsMade = 0, enrolled = 0;

  const usedNames = new Set((await prisma.studentProfile.findMany({ select: { name: true } })).map((s) => s.name));
  let seq = 0; // global index for deterministic, unique names
  const nameFor = (i: number) => {
    let k = 0;
    for (;;) {
      const n = `${FIRST[i % FIRST.length]} ${LAST[(i * 5 + Math.floor(i / FIRST.length) + k) % LAST.length]}`;
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
      k++;
    }
  };

  for (const t of TARGETS) {
    const session = await prisma.session.findUniqueOrThrow({ where: { name: t.session } });
    let next = t.first;
    for (const type of GROUPS) {
      const group = await prisma.group.findUniqueOrThrow({ where: { sessionId_type: { sessionId: session.id, type } } });
      let section = await prisma.section.findFirst({ where: { groupId: group.id, classLevel: t.classLevel, name: 'A', deletedAt: null } });
      if (!section) section = await prisma.section.create({ data: { id: `demo-section-${t.year}-${type}-a-c${t.classLevel}`, groupId: group.id, classLevel: t.classLevel, name: 'A' } });

      // Class 12 sections have no offerings yet: create them like the Class 11 ones (same subjects and teachers).
      for (const base of BASES[type]) {
        const [, , teacher, optional] = SUBJECTS.find((s) => s[0] === base)!;
        if (!teacher) continue;
        for (const code of [`${base}-1`, `${base}-2`]) {
          const course = await prisma.course.findUnique({ where: { code } });
          if (!course) continue;
          if (await prisma.courseOffering.findUnique({ where: { sectionId_courseId: { sectionId: section.id, courseId: course.id } } })) continue;
          const teacherId = (await prisma.user.findUniqueOrThrow({ where: { loginId: teacher } })).id;
          await prisma.courseOffering.create({ data: { id: `demo-offering-${section.id}-${code}`, sectionId: section.id, courseId: course.id, teacherId } });
          offeringsMade++;
          void optional;
        }
      }
      const ict = await prisma.course.findUnique({ where: { code: 'ICT' } });
      if (ict && !(await prisma.courseOffering.findUnique({ where: { sectionId_courseId: { sectionId: section.id, courseId: ict.id } } }))) {
        const teacherId = (await prisma.user.findUniqueOrThrow({ where: { loginId: 'T-0002' } })).id;
        await prisma.courseOffering.create({ data: { id: `demo-offering-${section.id}-ICT`, sectionId: section.id, courseId: ict.id, teacherId } });
        offeringsMade++;
      }

      // Top up to exactly 30 students.
      let have = await prisma.studentProfile.count({ where: { sectionId: section.id } });
      const usedRolls = new Set((await prisma.studentProfile.findMany({ where: { sectionId: section.id }, select: { roll: true } })).map((s) => s.roll));
      for (let roll = 1; have < PER_SECTION && roll <= 99; roll++) {
        const r = String(roll).padStart(2, '0');
        if (usedRolls.has(r)) continue;
        const loginId = `S-${t.year}-${String(next).padStart(4, '0')}`;
        next++;
        const exists = await prisma.user.findUnique({ where: { loginId } });
        if (exists) continue;
        const i = seq++;
        const password = old.get(loginId) ?? generatePassword();
        old.set(loginId, password);
        const name = nameFor(i);
        const lastName = name.split(' ')[1]!;
        const birthYear = t.classLevel === 12 ? 2008 + (i % 2) : 2009 + (i % 3);
        await prisma.user.create({
          data: {
            id: `demo-user-${loginId}`, loginId, role: 'student', status: 'active',
            mobile: `017${String(10000000 + ((i * 7919 + 13) % 89999999)).padStart(8, '0')}`,
            passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
            mustChangePassword: false, firstLogin: false,
            student: { create: {
              name, sectionId: section.id, roll: r,
              dob: new Date(Date.UTC(birthYear, (i * 5) % 12, 1 + ((i * 7) % 27))),
              address: TOWN[i % TOWN.length],
              guardianName: `${FATHER[i % FATHER.length]} ${lastName}`,
              guardianContact: `018${String(10000000 + ((i * 6151 + 29) % 89999999)).padStart(8, '0')}`,
            } },
          },
        });
        usedRolls.add(r); have++; created++;
      }

      // Enroll every student of the section in its non-optional offerings.
      const offerings = await prisma.courseOffering.findMany({ where: { sectionId: section.id, endedAt: null }, include: { course: true } });
      const students = await prisma.studentProfile.findMany({ where: { sectionId: section.id }, include: { user: true }, orderBy: { roll: 'asc' } });
      for (const o of offerings.filter((x) => !x.course.isOptional)) {
        for (const s of students) {
          if (await prisma.enrollment.findFirst({ where: { courseOfferingId: o.id, studentId: s.userId, status: 'active' } })) continue;
          await prisma.enrollment.create({ data: { courseOfferingId: o.id, studentId: s.userId } });
          enrolled++;
        }
      }

      for (const s of students) {
        const login = s.user.loginId ?? '';
        let pw = old.get(login);
        if (!pw) pw = (await argon2.verify(s.user.passwordHash ?? '', DEMO_PASSWORD).catch(() => false)) ? DEMO_PASSWORD : '(changed - unknown)';
        rows.push([login, pw, s.name, t.session, type, `Class ${t.classLevel}`, 'A', s.roll,
          s.dob ? s.dob.toISOString().slice(0, 10) : '-', s.guardianName ?? '-', s.guardianContact ?? '-', s.user.mobile ?? '-', s.address ?? '-']);
      }
    }
  }

  const head = ['Login ID', 'Password', 'Name', 'Session', 'Group', 'Class', 'Section', 'Roll', 'DOB', 'Guardian', 'Guardian contact', 'Mobile', 'Address'];
  const all = [head, ...rows.sort((a, b) => a[3]!.localeCompare(b[3]!) || a[4]!.localeCompare(b[4]!) || a[7]!.localeCompare(b[7]!))];
  const w = head.map((_, c) => Math.max(...all.map((r) => r[c]!.length)));
  const text = [
    'STUDENT LOGIN LIST (demo data). Contains plaintext passwords: do NOT commit or share.',
    `Total students: ${rows.length}`,
    '',
    ...all.map((r) => r.map((v, c) => v.padEnd(w[c]!)).join(' | ').trimEnd()),
    '',
  ].join('\n');
  fs.writeFileSync(FILE, text, 'utf8');
  console.log(`New students: ${created}, offerings created: ${offeringsMade}, enrollments added: ${enrolled}. Wrote ${rows.length} rows to ${FILE}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
