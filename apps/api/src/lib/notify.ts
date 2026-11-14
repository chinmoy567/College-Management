import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { defer } from './afterCommit';

type Db = Prisma.TransactionClient;
type Emitter = (userId: string, payload: { id: string; type: string; text: string; unread: number }) => void;
let emitter: Emitter = () => {};
/** Set by the socket server so `notif:new` reaches `user:<id>` rooms (07 §1). */
export const setNotifyEmitter = (fn: Emitter): void => {
  emitter = fn;
};

/** Minimal final-shape notify(): insert Notification rows and emit `notif:new`. Email/push fan-out arrives in M9. */
export async function notify(
  userIds: string[],
  type: string,
  ref: { type?: string; id?: string } | null,
  text: string,
  db: Db = prisma,
): Promise<void> {
  for (const userId of new Set(userIds)) {
    const n = await db.notification.create({ data: { userId, type, refType: ref?.type, refId: ref?.id, text } });
    const unread = await db.notification.count({ where: { userId, readAt: null } });
    defer(() => emitter(userId, { id: n.id, type, text, unread }));
  }
}

/** Same as notify() for a large audience: one insert and one unread-count query instead of two queries per user. */
export async function notifyBulk(
  userIds: string[],
  type: string,
  ref: { type?: string; id?: string } | null,
  text: string,
  db: Db = prisma,
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const created = await db.notification.createManyAndReturn({
    data: ids.map((userId) => ({ userId, type, refType: ref?.type, refId: ref?.id, text })),
    select: { id: true, userId: true },
  });
  const counts = await db.notification.groupBy({ by: ['userId'], where: { userId: { in: ids }, readAt: null }, _count: { _all: true } });
  const unread = new Map(counts.map((c) => [c.userId, c._count._all]));
  for (const n of created) defer(() => emitter(n.userId, { id: n.id, type, text, unread: unread.get(n.userId) ?? 1 }));
}
