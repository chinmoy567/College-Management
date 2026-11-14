import webpush from 'web-push';
import { prisma } from '../db';
import { logger } from './logger';
import { enqueue, jobsRunning, registerJob } from '../jobs';

/** Generic payload only: a title, a short generic text and a URL. Never message or post content (07 §6). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export type PushSender = (target: PushTarget, payload: string) => Promise<void>;

let configured = false;
const defaultSender: PushSender = async (t, payload) => {
  if (!configured) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) throw new Error('VAPID keys are not set');
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  }
  await webpush.sendNotification(t, payload, { TTL: 3600 });
};
let sender: PushSender = defaultSender;
/** Tests replace the web-push call. */
export const setPushSender = (s: PushSender | null): void => {
  sender = s ?? defaultSender;
};

type Sink = (userId: string, p: PushPayload) => Promise<void>;
let sink: Sink | undefined;
/** Tests capture queued pushes instead of enqueuing a job. */
export const setPushSink = (s: Sink | undefined): void => {
  sink = s;
};

/** Sends to every subscription of the user; a 404/410 from the push service deletes that subscription. */
export async function deliverPush(userId: string, payload: PushPayload): Promise<number> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url });
  for (const s of subs) {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
      else logger.warn({ userId, status }, 'push failed');
    }
  }
  return sent;
}

export async function queuePush(userId: string, p: PushPayload): Promise<void> {
  if (sink) return sink(userId, p);
  if (jobsRunning()) await enqueue('push.send', { userId, p }, { retryLimit: 1 });
}
export const registerPushWorker = (): Promise<void> =>
  registerJob<{ userId: string; p: PushPayload }>('push.send', async (d) => void (await deliverPush(d.userId, d.p)));
