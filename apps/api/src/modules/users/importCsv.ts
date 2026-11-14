import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { SECTION_MAX, normaliseSessionName } from '@cms/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { hashPassword } from '../../lib/crypto';
import { AppError } from '../../lib/http';
import { generatePassword } from '../../lib/passwordGen';
import { insertStudent, insertTeacher } from './service';
import type { Slip } from './slips';

type Tx = Prisma.TransactionClient;
export const MAX_ROWS = 1000;
export interface RowError {
  row: number;
  field: string;
  message: string;
}

/** Thrown by the real run when re-validation fails: nothing was imported. */
export class ImportInvalid extends Error {
  constructor(public errors: RowError[]) {
    super('Import failed validation');
  }
}

const emailSchema = z.string().email();

function readCsv(buffer: Buffer, required: string[]): Record<string, string>[] {
  let rows: Record<string, string>[];
  try {
    rows = parse(buffer, { bom: true, columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
  } catch {
    throw new AppError('VALIDATION_ERROR', 400, 'The file is not a valid CSV.', { file: 'invalid_csv' });
  }
  if (rows.length === 0) throw new AppError('VALIDATION_ERROR', 400, 'The file has no rows.', { file: 'empty' });
  if (rows.length > MAX_ROWS) throw new AppError('VALIDATION_ERROR', 400, `At most ${MAX_ROWS} rows per file.`, { file: 'too_many_rows' });
  const missing = required.filter((c) => !(c in rows[0]!));
  if (missing.length) throw new AppError('VALIDATION_ERROR', 400, `Missing columns: ${missing.join(', ')}.`, { file: 'missing_columns' });
  return rows;
}

// ───── students ─────
interface StudentPlan {
  row: number;
  name: string;
  roll: string;
  email: string;
  sectionId: string;
  sessionName: string;
  placement: string;
}

async function validateStudents(db: Tx, raw: Record<string, string>[]): Promise<{ plans: StudentPlan[]; errors: RowError[] }> {
  const errors: RowError[] = [];
  const err = (row: number, field: string, message: string) => errors.push({ row, field, message });
  const sessions = await db.session.findMany({ include: { groups: { include: { sections: { where: { deletedAt: null } } } } } });
  const bySession = new Map(sessions.map((s) => [s.name, s]));

  const resolved: (StudentPlan & { classLevel: number })[] = [];
  raw.forEach((r, i) => {
    const row = i + 2; // header is row 1
    const name = (r.name ?? '').trim();
    const roll = (r.roll ?? '').trim();
    const email = (r.email ?? '').trim().toLowerCase();
    let bad = false;
    if (!name) {
      err(row, 'name', 'Name is required.');
      bad = true;
    }
    if (!roll) {
      err(row, 'roll', 'Roll is required.');
      bad = true;
    }
    if (!emailSchema.safeParse(email).success) {
      err(row, 'email', 'Enter a valid email.');
      bad = true;
    }
    const sess = bySession.get(normaliseSessionName(r.session ?? ''));
    if (!sess) return void err(row, 'session', 'Unknown session.');
    const group = sess.groups.find((g) => g.type === (r.group ?? '').trim().toLowerCase());
    if (!group) return void err(row, 'group', 'Unknown group (science, commerce or arts).');
    const named = group.sections.filter((s) => s.name.toLowerCase() === (r.section ?? '').trim().toLowerCase());
    const wantedClass = (r.class ?? '').trim();
    const candidates = wantedClass ? named.filter((s) => String(s.classLevel) === wantedClass) : named;
    if (candidates.length === 0) return void err(row, 'section', 'Unknown section.');
    if (candidates.length > 1) return void err(row, 'section', 'More than one class has this section name. Add a "class" column (11 or 12).');
    const section = candidates[0]!;
    if (sess.status === 'closed') return void err(row, 'session', 'This session is closed.');
    if (bad) return;
    resolved.push({
      row, name, roll, email, sectionId: section.id, sessionName: sess.name, classLevel: section.classLevel,
      placement: `${sess.name} · ${group.type} · ${section.classLevel}-${section.name}`,
    });
  });

  // duplicates inside the file
  const seenEmail = new Map<string, number>();
  const seenRoll = new Map<string, number>();
  for (const p of resolved) {
    const e = seenEmail.get(p.email);
    if (e !== undefined) err(p.row, 'email', `Duplicate email (also row ${e}).`);
    else seenEmail.set(p.email, p.row);
    const rk = `${p.sectionId}|${p.roll}`;
    const rr = seenRoll.get(rk);
    if (rr !== undefined) err(p.row, 'roll', `Duplicate roll in the section (also row ${rr}).`);
    else seenRoll.set(rk, p.row);
  }
  // duplicates in the database
  const emails = await db.user.findMany({ where: { email: { in: resolved.map((p) => p.email) } }, select: { email: true } });
  const takenEmail = new Set(emails.map((e) => e.email));
  const sectionIds = [...new Set(resolved.map((p) => p.sectionId))];
  const rolls = await db.studentProfile.findMany({ where: { sectionId: { in: sectionIds } }, select: { sectionId: true, roll: true } });
  const takenRoll = new Set(rolls.map((r) => `${r.sectionId}|${r.roll}`));
  const active = await db.studentProfile.groupBy({ by: ['sectionId'], where: { sectionId: { in: sectionIds }, user: { status: 'active' } }, _count: true });
  const room = new Map(sectionIds.map((id) => [id, SECTION_MAX - (active.find((a) => a.sectionId === id)?._count ?? 0)]));
  for (const p of resolved) {
    if (takenEmail.has(p.email)) err(p.row, 'email', 'This email is already used.');
    if (takenRoll.has(`${p.sectionId}|${p.roll}`)) err(p.row, 'roll', 'This roll number is already used in the section.');
    const left = room.get(p.sectionId)!;
    if (left <= 0) err(p.row, 'section', `Section is full (${SECTION_MAX} students). Choose or create another section.`);
    else room.set(p.sectionId, left - 1);
  }
  errors.sort((a, b) => a.row - b.row);
  const bad = new Set(errors.map((e) => e.row));
  return { plans: resolved.filter((p) => !bad.has(p.row)), errors };
}

export async function dryRunStudents(buffer: Buffer) {
  const rows = readCsv(buffer, ['name', 'roll', 'email', 'session', 'group', 'section']);
  const { plans, errors } = await validateStudents(prisma, rows);
  return { total: rows.length, valid: plans.length, errors };
}

async function hashAll(count: number): Promise<{ password: string; hash: string }[]> {
  const out: { password: string; hash: string }[] = [];
  for (let i = 0; i < count; i += 8) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(8, count - i) }, async () => {
        const password = generatePassword();
        return { password, hash: await hashPassword(password) };
      }),
    );
    out.push(...batch);
  }
  return out;
}

export async function importStudents(actorId: string, buffer: Buffer, ip?: string): Promise<{ created: number; slips: Slip[] }> {
  const rows = readCsv(buffer, ['name', 'roll', 'email', 'session', 'group', 'section']);
  const pre = await validateStudents(prisma, rows);
  if (pre.errors.length) throw new ImportInvalid(pre.errors);
  const creds = await hashAll(rows.length);
  return prisma.$transaction(
    async (tx) => {
      // Lock every affected section in sorted id order (no deadlocks between two imports), then re-validate.
      const ids = [...new Set(pre.plans.map((p) => p.sectionId))].sort();
      for (const id of ids) await tx.$queryRaw`SELECT id FROM sections WHERE id = ${id} FOR UPDATE`;
      const again = await validateStudents(tx, rows);
      if (again.errors.length) throw new ImportInvalid(again.errors);
      const slips: Slip[] = [];
      for (const [i, p] of again.plans.entries()) {
        const c = creds[i]!;
        const s = await insertStudent(tx, { name: p.name, roll: p.roll, email: p.email, sectionId: p.sectionId }, p.sessionName, c.hash);
        slips.push({ role: 'student', name: p.name, loginId: s.loginId, password: c.password, placement: p.placement });
      }
      await audit(actorId, 'student.import', 'section', ids[0]!, { count: slips.length, sectionIds: ids }, ip, tx);
      return { created: slips.length, slips };
    },
    { timeout: 120_000 },
  );
}

// ───── teachers ─────
interface TeacherPlan {
  row: number;
  name: string;
  email: string;
  designation?: string;
  subjects: string[];
}

async function validateTeachers(db: Tx, raw: Record<string, string>[]): Promise<{ plans: TeacherPlan[]; errors: RowError[] }> {
  const errors: RowError[] = [];
  const plans: TeacherPlan[] = [];
  const seen = new Map<string, number>();
  const emails = await db.user.findMany({
    where: { email: { in: raw.map((r) => (r.email ?? '').trim().toLowerCase()).filter(Boolean) } },
    select: { email: true },
  });
  const taken = new Set(emails.map((e) => e.email));
  raw.forEach((r, i) => {
    const row = i + 2;
    const name = (r.name ?? '').trim();
    const email = (r.email ?? '').trim().toLowerCase();
    const before = errors.length;
    if (!name) errors.push({ row, field: 'name', message: 'Name is required.' });
    if (!emailSchema.safeParse(email).success) errors.push({ row, field: 'email', message: 'Enter a valid email.' });
    else if (seen.has(email)) errors.push({ row, field: 'email', message: `Duplicate email (also row ${seen.get(email)}).` });
    else if (taken.has(email)) errors.push({ row, field: 'email', message: 'This email is already used.' });
    if (!seen.has(email)) seen.set(email, row);
    if (errors.length === before)
      plans.push({
        row, name, email, designation: (r.designation ?? '').trim() || undefined,
        subjects: (r.subjects ?? '').split(';').map((s) => s.trim()).filter(Boolean),
      });
  });
  return { plans, errors };
}

export async function dryRunTeachers(buffer: Buffer) {
  const rows = readCsv(buffer, ['name', 'email']);
  const { plans, errors } = await validateTeachers(prisma, rows);
  return { total: rows.length, valid: plans.length, errors };
}

export async function importTeachers(actorId: string, buffer: Buffer, ip?: string): Promise<{ created: number; slips: Slip[] }> {
  const rows = readCsv(buffer, ['name', 'email']);
  const pre = await validateTeachers(prisma, rows);
  if (pre.errors.length) throw new ImportInvalid(pre.errors);
  const creds = await hashAll(rows.length);
  return prisma.$transaction(
    async (tx) => {
      const again = await validateTeachers(tx, rows);
      if (again.errors.length) throw new ImportInvalid(again.errors);
      const slips: Slip[] = [];
      for (const [i, p] of again.plans.entries()) {
        const c = creds[i]!;
        const t = await insertTeacher(tx, p, c.hash);
        slips.push({ role: 'teacher', name: p.name, loginId: t.loginId, password: c.password });
      }
      await audit(actorId, 'teacher.import', 'user', 'bulk', { count: slips.length }, ip, tx);
      return { created: slips.length, slips };
    },
    { timeout: 120_000 },
  );
}
