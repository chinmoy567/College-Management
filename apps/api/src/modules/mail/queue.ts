import nodemailer from 'nodemailer';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { logger } from '../../lib/logger';
import { dhakaDate } from '../../lib/time';
import { enqueue, registerJob } from '../../jobs';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Auth link (reset / verify). Logged at warn when SMTP fails and LOG_EMAIL_LINKS=true. */
  link?: string;
}
export type EmailPriority = 'high' | 'normal';

type Sink = (m: EmailMessage, p: EmailPriority) => Promise<void>;
let sink: Sink | undefined;
/** Tests replace the queue with an in-memory capture. */
export const setEmailSink = (s: Sink | undefined): void => {
  sink = s;
};

export async function queueEmail(m: EmailMessage, priority: EmailPriority = 'normal'): Promise<void> {
  if (sink) return sink(m, priority);
  await enqueue('email.send', { m, priority }, { priority: priority === 'high' ? 10 : 0 });
}

async function dailyLimit(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: 'email_daily_limit' } });
  return typeof s?.value === 'number' ? s.value : 450;
}

/** 02/07: normal mail stops at 90 % of the limit; high keeps the last 10 %. */
export async function takeQuota(priority: EmailPriority, now = new Date()): Promise<boolean> {
  const limit = await dailyLimit();
  const cap = priority === 'high' ? limit : Math.floor(limit * 0.9);
  const date = new Date(`${dhakaDate(now)}T00:00:00Z`);
  const rows = await prisma.$queryRaw<{ sent: number }[]>(Prisma.sql`
    INSERT INTO email_quotas (date, sent) VALUES (${date}::date, 1)
    ON CONFLICT (date) DO UPDATE SET sent = email_quotas.sent + 1
      WHERE email_quotas.sent < ${cap}
    RETURNING sent`);
  return rows.length > 0;
}

async function deliver(m: EmailMessage): Promise<void> {
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await t.sendMail({ from: process.env.SMTP_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
}

export async function processEmail(data: { m: EmailMessage; priority: EmailPriority }): Promise<void> {
  if (!(await takeQuota(data.priority))) {
    // Over the daily limit: re-schedule for 00:05 Dhaka next day.
    const next = new Date(`${dhakaDate(new Date(Date.now() + 24 * 3600 * 1000))}T00:05:00+06:00`);
    await enqueue('email.send', data, { startAfter: next, priority: data.priority === 'high' ? 10 : 0 });
    return;
  }
  try {
    await deliver(data.m);
  } catch (err) {
    if (data.m.link && process.env.LOG_EMAIL_LINKS === 'true') {
      logger.warn({ link: data.m.link, to: data.m.to }, 'SMTP failed; email link logged for demo');
      return;
    }
    throw err; // pg-boss retries (3, exponential backoff)
  }
}

export const registerEmailWorker = (): Promise<void> => registerJob('email.send', processEmail);
