import type { Express } from 'express';
import type { PrismaClient, User } from '@prisma/client';
import { hashPassword } from '../apps/api/src/lib/crypto';
import { PW, adminClient, clientFor, makeApp, makeTeacher, uniq } from './factories';

export { PW, adminClient, clientFor, makeApp, makeTeacher, uniq };

let yearSeq = 0;
/** A valid, unique session name such as "2501–02". */
export const sessionNameSeq = (): string => {
  const n = ++yearSeq + (process.pid % 7000);
  return `${2100 + n}–${String(n % 100).padStart(2, '0')}`;
};

export interface Tree {
  sessionId: string;
  groups: Record<'science' | 'commerce' | 'arts', { id: string; sectionId: string }>;
}

/** Creates a session through the API (what ACAD-01 asserts) and returns the ids. */
export async function makeSessionViaApi(c: ReturnType<typeof import('./factories').client>): Promise<Tree> {
  const res = await c.post('/api/academics/sessions', { name: sessionNameSeq() });
  if (res.status !== 201) throw new Error(`session create failed ${res.status} ${JSON.stringify(res.body)}`);
  const groups = {} as Tree['groups'];
  for (const g of res.body.groups as { id: string; type: 'science' | 'commerce' | 'arts'; sections: { id: string }[] }[]) {
    groups[g.type] = { id: g.id, sectionId: g.sections[0]!.id };
  }
  return { sessionId: res.body.id as string, groups };
}

/** Bulk-creates students straight in the database (fast), for limit tests. */
export async function fillStudents(
  prisma: PrismaClient,
  sectionId: string,
  n: number,
  status: 'active' | 'inactive' | 'passed_out' | 'deleted' = 'active',
  startRoll = 1,
): Promise<User[]> {
  const out: User[] = [];
  const hash = await hashPassword(PW);
  for (let i = 0; i < n; i++) {
    out.push(
      await prisma.user.create({
        data: {
          role: 'student', loginId: uniq('FS'), email: `${uniq('fs')}@x.test`, passwordHash: hash, status, firstLogin: false, mustChangePassword: false,
          student: { create: { name: `Filler ${i}`, roll: String(uniq('r') + startRoll + i), sectionId } },
        },
      }),
    );
  }
  return out;
}

let courseSeq = 0;
export async function makeCourse(
  prisma: PrismaClient,
  o: Partial<{ groupType: 'science' | 'commerce' | 'arts' | 'common'; classLevel: 'c11' | 'c12' | 'both'; isOptional: boolean }> = {},
) {
  return prisma.course.create({
    data: { code: `${uniq('CRS')}-${++courseSeq}`, name: 'Course', groupType: o.groupType ?? 'common', classLevel: o.classLevel ?? 'both', isOptional: o.isOptional ?? false },
  });
}

export async function makeApi(): Promise<Express> {
  return makeApp();
}
