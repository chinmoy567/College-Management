import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { defer } from './afterCommit';

type Db = Prisma.TransactionClient;
export interface RoomDiff {
  joined: string[];
  left: string[];
}
type RoomHook = (userId: string, diff: RoomDiff) => void;
let roomHook: RoomHook = () => {};
/** Set by the socket server so live sockets join/leave `conv:<id>` rooms. */
export const setRoomHook = (fn: RoomHook): void => {
  roomHook = fn;
};

/** Conversation row for a group or section. Idempotent. */
export async function ensureConversation(db: Db, type: 'group' | 'section', refId: string): Promise<string> {
  const c = await db.conversation.upsert({ where: { type_refId: { type, refId } }, create: { type, refId }, update: {} });
  return c.id;
}

/** The conversations a user should belong to, computed from current data (07 §2.3, PRD §5.7). */
async function desiredConversations(db: Db, userId: string): Promise<Set<string>> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      student: {
        select: { section: { select: { id: true, deletedAt: true, groupId: true, group: { select: { session: { select: { status: true } } } } } } },
      },
    },
  });
  if (!user || user.status === 'deleted' || user.status === 'passed_out') return new Set();
  const sections = new Set<string>(); // section chats
  const groups = new Set<string>(); // group chats
  if (user.role === 'student' && user.student) {
    const s = user.student.section;
    if (!s.deletedAt && s.group.session.status === 'active') {
      sections.add(s.id);
      groups.add(s.groupId);
    }
  } else if (user.role === 'teacher') {
    // Teachers of a section join its section chat; mentors also join the section chat and the group chat.
    const taught = await db.section.findMany({
      where: { deletedAt: null, group: { session: { status: 'active' } }, offerings: { some: { teacherId: userId, endedAt: null } } },
      select: { id: true },
    });
    for (const s of taught) sections.add(s.id);
    const mentored = await db.section.findFirst({
      where: { mentorTeacherId: userId, deletedAt: null, group: { session: { status: 'active' } } },
      select: { id: true, groupId: true },
    });
    if (mentored) {
      sections.add(mentored.id);
      groups.add(mentored.groupId);
    }
  }
  if (!sections.size && !groups.size) return new Set();
  const convs = await db.conversation.findMany({
    where: { OR: [{ type: 'section', refId: { in: [...sections] } }, { type: 'group', refId: { in: [...groups] } }] },
    select: { id: true },
  });
  return new Set(convs.map((c) => c.id));
}

/**
 * Recomputes the user's group/section chat membership: sets `leftAt` on extras, inserts or reactivates missing
 * ones (desired set vs current set, so any ordering of moves and mentor changes converges). Inactive users keep
 * their rows. Live socket rooms are updated through the hook right away.
 */
export async function sync(userId: string, db: Db = prisma): Promise<RoomDiff> {
  const desired = await desiredConversations(db, userId);
  const current = await db.conversationMember.findMany({
    where: { userId, conversation: { type: { in: ['group', 'section'] } } },
    select: { conversationId: true, leftAt: true },
  });
  const diff: RoomDiff = { joined: [], left: [] };
  const byConv = new Map(current.map((m) => [m.conversationId, m]));
  for (const convId of desired) {
    const m = byConv.get(convId);
    if (!m) {
      await db.conversationMember.create({ data: { conversationId: convId, userId } });
      diff.joined.push(convId);
    } else if (m.leftAt) {
      await db.conversationMember.update({
        where: { conversationId_userId: { conversationId: convId, userId } },
        data: { leftAt: null, joinedAt: new Date() },
      });
      diff.joined.push(convId);
    }
  }
  for (const m of current) {
    if (!desired.has(m.conversationId) && !m.leftAt) {
      await db.conversationMember.update({
        where: { conversationId_userId: { conversationId: m.conversationId, userId } },
        data: { leftAt: new Date() },
      });
      diff.left.push(m.conversationId);
    }
  }
  if (diff.joined.length || diff.left.length) defer(() => roomHook(userId, diff));
  return diff;
}

export async function syncMany(userIds: Iterable<string>, db: Db = prisma): Promise<void> {
  for (const id of new Set(userIds)) await sync(id, db);
}

export const chatMembership = { sync, syncMany, ensureConversation };
