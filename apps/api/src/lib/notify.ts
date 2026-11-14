import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { defer } from './afterCommit';
import { logger } from './logger';
import { queuePush } from './push';
import { queueEmail } from '../modules/mail/queue';
import { notificationEmail } from '../modules/mail/templates';

type Db = Prisma.TransactionClient;
type Emitter = (userId: string, payload: { id: string; type: string; text: string; unread: number }) => void;
let emitter: Emitter = () => {};
/** Set by the socket server so `notif:new` reaches `user:<id>` rooms (07 §1). */
export const setNotifyEmitter = (fn: Emitter): void => {
  emitter = fn;
};

export interface NotifyOpts {
  /** Generic text for push (defaults to `text`). Must not contain message or post content. */
  pushText?: string;
  /** Types that email (07 §4.1). `forced` ignores the user's preference (urgent notices, PRD §5.10). */
  email?: { subject: string; text: string; html?: string; forced?: boolean };
}
type Ref = { type?: string; id?: string } | null;

const pending = new Set<Promise<unknown>>();
/** Tests await this to see email/push fan-out finished. */
export const flushNotifications = async (): Promise<void> => {
  while (pending.size) await Promise.all([...pending]);
};

const urlFor = (ref: Ref): string =>
  ref?.type === 'conversation' && ref.id ? `/messages/${ref.id}` : ref?.type === 'notice' ? '/notices' : '/notifications';

/** Email and push after the rows exist. In-app delivery never waits for this (07 §5). */
async function fanOut(userIds: string[], type: string, ref: Ref, text: string, opts: NotifyOpts): Promise<void> {
  const [prefs, subs, users] = await Promise.all([
    prisma.notificationPref.findMany({ where: { userId: { in: userIds }, type } }),
    prisma.pushSubscription.findMany({ where: { userId: { in: userIds } }, select: { userId: true } }),
    opts.email
      ? prisma.user.findMany({
          where: { id: { in: userIds }, status: 'active' },
          select: { id: true, email: true, student: { select: { name: true } }, teacher: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const pref = new Map(prefs.map((p) => [p.userId, p]));
  const hasPush = new Set(subs.map((s) => s.userId));
  for (const id of userIds) {
    if (hasPush.has(id) && pref.get(id)?.push !== false)
      await queuePush(id, { title: 'College', body: opts.pushText ?? text, url: urlFor(ref) }).catch((err) => logger.warn({ err }, 'push enqueue failed'));
  }
  const em = opts.email;
  if (em) {
    for (const u of users) {
      if (!u.email) continue;
      if (!em.forced && pref.get(u.id)?.email === false) continue;
      const m = notificationEmail(u.student?.name ?? u.teacher?.name ?? 'there', em);
      await queueEmail({ to: u.email, ...m }, 'normal').catch((err) => logger.warn({ err }, 'email enqueue failed'));
    }
  }
}
function scheduleFanOut(userIds: string[], type: string, ref: Ref, text: string, opts: NotifyOpts): void {
  const p = fanOut(userIds, type, ref, text, opts).catch((err) => logger.warn({ err }, 'notification fan-out failed'));
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** Inserts Notification rows, emits `notif:new`, then queues push and email per the user's prefs. */
export async function notify(userIds: string[], type: string, ref: Ref, text: string, db: Db = prisma, opts: NotifyOpts = {}): Promise<void> {
  const ids = [...new Set(userIds)];
  for (const userId of ids) {
    const n = await db.notification.create({ data: { userId, type, refType: ref?.type, refId: ref?.id, text } });
    const unread = await db.notification.count({ where: { userId, readAt: null } });
    defer(() => emitter(userId, { id: n.id, type, text, unread }));
  }
  if (ids.length) defer(() => scheduleFanOut(ids, type, ref, text, opts));
}

/** Same as notify() for a large audience: one insert and one unread-count query instead of two queries per user. */
export async function notifyBulk(userIds: string[], type: string, ref: Ref, text: string, db: Db = prisma, opts: NotifyOpts = {}): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const created = await db.notification.createManyAndReturn({
    data: ids.map((userId) => ({ userId, type, refType: ref?.type, refId: ref?.id, text })),
    select: { id: true, userId: true },
  });
  const counts = await db.notification.groupBy({ by: ['userId'], where: { userId: { in: ids }, readAt: null }, _count: { _all: true } });
  const unread = new Map(counts.map((c) => [c.userId, c._count._all]));
  for (const n of created) defer(() => emitter(n.userId, { id: n.id, type, text, unread: unread.get(n.userId) ?? 1 }));
  defer(() => scheduleFanOut(ids, type, ref, text, opts));
}
