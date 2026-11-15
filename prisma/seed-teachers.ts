/** Adds one teacher per subject (Science, Commerce, Arts) with a random password; prints the credentials. Idempotent by name. */
import 'dotenv/config';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const TEACHERS: [string, string, string][] = [
  // [group, name, subject]
  ['Science', 'Nasrin Akter', 'biology'],
  ['Science', 'Mizanur Rahman', 'higher math'],
  ['Commerce', 'Shamim Hossain', 'business organization'],
  ['Commerce', 'Farzana Yasmin', 'finance and banking'],
  ['Commerce', 'Tarek Aziz', 'production management and marketing'],
  ['Commerce', 'Lutfa Begum', 'statistics'],
  ['Arts', 'Abul Kalam', 'bangla'],
  ['Arts', 'Jahanara Parvin', 'history'],
  ['Arts', 'Monirul Islam', 'geography'],
  ['Arts', 'Shirin Sultana', 'civics'],
  ['Arts', 'Habibur Rahman', 'economics'],
  ['Arts', 'Rokeya Khanom', 'sociology'],
  ['Arts', 'Mahbub Alam', 'islamic history'],
  ['Arts', 'Maulana Anwar Hossain', 'islamic studies'],
  ['Arts', 'Salim Reza', 'logic'],
  ['Arts', 'Nazma Akter', 'social work'],
  ['Arts', 'Dilruba Haque', 'psychology'],
  ['Science/Commerce', 'Kamrul Hasan', 'agriculture'],
];

const pw = () => randomBytes(6).toString('base64url') + '#7a';

async function main() {
  const prisma = new PrismaClient();
  const existing = await prisma.user.findMany({ where: { role: 'teacher' }, select: { loginId: true } });
  let n = Math.max(0, ...existing.map((u) => Number(u.loginId.replace('T-', '')) || 0));
  console.log('Group     | Subject | Teacher | Login ID | Password');
  for (const [group, name, subject] of TEACHERS) {
    const dup = await prisma.teacherProfile.findFirst({ where: { name } });
    if (dup) { console.log(`skip (exists): ${name}`); continue; }
    n++;
    const loginId = `T-${String(n).padStart(4, '0')}`;
    const password = pw();
    await prisma.user.create({
      data: {
        loginId, role: 'teacher', email: `${loginId.toLowerCase()}@demo.example.edu`,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        mustChangePassword: false, firstLogin: false,
        teacher: { create: { name, designation: 'Lecturer', subjects: [subject] } },
      },
    });
    console.log(`${group} | ${subject} | ${name} | ${loginId} | ${password}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
