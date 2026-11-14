import { Router } from 'express';
import { NOTIFICATION_TYPES, cursorQuery, notificationPrefsBody, notificationsReadBody, pushSubscribeBody, pushUnsubscribeBody } from '@cms/shared';
import type { z } from 'zod';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { asyncHandler, validate } from '../../lib/http';
import { decodeCursor, encodeCursor } from '../../lib/pagination';
import { realtime } from '../../lib/realtime';
import { actorOf } from '../feed/common';

export const notificationsRouter = Router();

const unreadOf = (userId: string) => prisma.notification.count({ where: { userId, readAt: null } });

notificationsRouter.get(
  '/',
  validate({ query: cursorQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof cursorQuery>;
    const cur = decodeCursor(q.cursor);
    const rows = await prisma.notification.findMany({
      where: {
        userId: actorOf(req).id,
        ...(cur ? { OR: [{ createdAt: { lt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { lt: cur.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    res.json({
      items: page.map((n) => ({ id: n.id, type: n.type, refType: n.refType, refId: n.refId, text: n.text, read: !!n.readAt, createdAt: n.createdAt.toISOString() })),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    });
  }),
);
notificationsRouter.get('/unread-count', asyncHandler(async (req, res) => void res.json({ unread: await unreadOf(actorOf(req).id) })));
notificationsRouter.post(
  '/read',
  validate({ body: notificationsReadBody }),
  asyncHandler(async (req, res) => {
    const me = actorOf(req).id;
    const b = req.body as z.infer<typeof notificationsReadBody>;
    await prisma.notification.updateMany({ where: { userId: me, readAt: null, ...('all' in b ? {} : { id: { in: b.ids } }) }, data: { readAt: now() } });
    const unread = await unreadOf(me);
    realtime().toUser(me, 'notif:count', { unread });
    res.json({ unread });
  }),
);

/** Mounted under /api/me: preferences and push subscriptions. */
export const notificationPrefsRouter = Router();
notificationPrefsRouter.get(
  '/notification-prefs',
  asyncHandler(async (req, res) => {
    const rows = await prisma.notificationPref.findMany({ where: { userId: actorOf(req).id } });
    const by = new Map(rows.map((r) => [r.type, r]));
    res.json({
      prefs: NOTIFICATION_TYPES.map((type) => ({ type, email: by.get(type)?.email ?? true, push: by.get(type)?.push ?? true })),
      note: 'Urgent notices are always emailed, whatever you choose here.',
    });
  }),
);
notificationPrefsRouter.put(
  '/notification-prefs',
  validate({ body: notificationPrefsBody }),
  asyncHandler(async (req, res) => {
    const me = actorOf(req).id;
    const { prefs } = req.body as z.infer<typeof notificationPrefsBody>;
    await prisma.$transaction(
      prefs.map((p) =>
        prisma.notificationPref.upsert({
          where: { userId_type: { userId: me, type: p.type } },
          create: { userId: me, type: p.type, email: p.email, push: p.push },
          update: { email: p.email, push: p.push },
        }),
      ),
    );
    res.json({ ok: true });
  }),
);
notificationPrefsRouter.post(
  '/push-subscriptions',
  validate({ body: pushSubscribeBody }),
  asyncHandler(async (req, res) => {
    const me = actorOf(req).id;
    const b = req.body as z.infer<typeof pushSubscribeBody>;
    await prisma.pushSubscription.upsert({
      where: { endpoint: b.endpoint },
      create: { userId: me, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth },
      update: { userId: me, p256dh: b.keys.p256dh, auth: b.keys.auth },
    });
    res.status(201).json({ ok: true });
  }),
);
notificationPrefsRouter.delete(
  '/push-subscriptions',
  validate({ body: pushUnsubscribeBody }),
  asyncHandler(async (req, res) => {
    await prisma.pushSubscription.deleteMany({ where: { userId: actorOf(req).id, endpoint: (req.body as { endpoint: string }).endpoint } });
    res.json({ ok: true });
  }),
);
