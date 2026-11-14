import { prisma } from '../db';
import { signMany } from './files';

export interface AuthorLine {
  id: string | null;
  name: string;
  avatarUrl: string | null;
  role: 'admin' | 'teacher' | 'student' | null;
  line: string | null;
}
export const DELETED_AUTHOR: AuthorLine = { id: null, name: 'Deleted user', avatarUrl: null, role: null, line: null };

const GROUP = { science: 'Science', commerce: 'Commerce', arts: 'Arts' } as const;
type SectionLabel = { name: string; group: { type: keyof typeof GROUP; session: { name: string } } };
/** "2024–25 Science-A" (PRD §5.7.1 / §5.7.2). */
export const mentorLabel = (s: SectionLabel): string => `${s.group.session.name} ${GROUP[s.group.type]}-${s.name}`;

/** Pure formatting (PRD §5.7.1), kept separate so COMM-13 can test every shape. */
export function formatLine(u: {
  role: 'admin' | 'teacher' | 'student';
  status: 'active' | 'inactive' | 'passed_out' | 'deleted';
  section?: SectionLabel | null;
  mentored?: SectionLabel | null;
}): string | null {
  if (u.status !== 'active') return null;
  if (u.role === 'admin') return 'Admin';
  if (u.role === 'student') return u.section ? `${u.section.group.session.name} · ${GROUP[u.section.group.type]} · ${u.section.name}` : null;
  return u.mentored ? `Teacher · Section Mentor · ${mentorLabel(u.mentored)}` : 'Teacher';
}

const sectionSelect = { select: { name: true, group: { select: { type: true, session: { select: { name: true } } } } } } as const;

/** One serializer for posts, comments, chat and notices (COMM-13). Loads every author in 3 queries, no N+1. */
export async function loadAuthors(ids: (string | null | undefined)[]): Promise<Map<string, AuthorLine>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, AuthorLine>();
  if (want.length === 0) return out;
  const users = await prisma.user.findMany({
    where: { id: { in: want } },
    select: {
      id: true, role: true, status: true, avatarId: true, anonymisedAt: true,
      student: { select: { name: true, section: { ...sectionSelect } } },
      teacher: { select: { name: true, mentoredSection: { ...sectionSelect } } },
    },
  });
  const urls = await signMany(users.filter((u) => u.status !== 'deleted' && !u.anonymisedAt).map((u) => u.avatarId).filter((x): x is string => !!x));
  for (const u of users) {
    if (u.status === 'deleted' || u.anonymisedAt) {
      out.set(u.id, DELETED_AUTHOR);
      continue;
    }
    out.set(u.id, {
      id: u.id,
      name: u.student?.name ?? u.teacher?.name ?? 'Admin',
      avatarUrl: u.avatarId ? (urls.get(u.avatarId) ?? null) : null,
      role: u.role,
      line: formatLine({ role: u.role, status: u.status, section: u.student?.section, mentored: u.teacher?.mentoredSection }),
    });
  }
  return out;
}
export const authorOf = (m: Map<string, AuthorLine>, id: string): AuthorLine => m.get(id) ?? DELETED_AUTHOR;
