import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

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
    emitter(userId, { id: n.id, type, text, unread });
  }
}
