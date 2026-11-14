import type { Prisma } from '@prisma/client';
import type { OnlineClassCreateBody, OnlineClassUpdateBody } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { AppError } from '../../lib/http';
import { notifyBulk } from '../../lib/notify';
import type { Actor } from '../../lib/permissions';
import { formatDhaka } from '../../lib/time';
import { enqueue, jobsRunning } from '../../jobs';
import { attachOrCreateMeetings, detachOnlineClass } from '../schedule/onlineHook';
import { NOT_FOUND, bad, enrolledStudentIds, mentoredOfferingIds, studentScope } from './common';
import { detectPlatform } from './videoUrl';

export const JOIN_OPENS_BEFORE_MIN = 10;
export const REMIND_BEFORE_MIN = 15;
const MIN = 60_000;

type Status = 'scheduled' | 'live' | 'ended' | 'cancelled';
/** Status from the clock, so a sleeping server never shows a stale value (08 §1). */
export function derivedStatus(c: { status: Status; startAt: Date; durationMin: number }, at: Date = now()): Status {
  if (c.status === 'cancelled') return 'cancelled';
  if (at < c.startAt) return 'scheduled';
  return at < new Date(c.startAt.getTime() + c.durationMin * MIN) ? 'live' : 'ended';
}

const when = (d: Date) => formatDhaka(d, 'd MMM, h:mm a');

async function ownOfferings(actor: Actor, offeringIds: string[]): Promise<void> {
  const ids = [...new Set(offeringIds)];
  const found = await prisma.courseOffering.findMany({ where: { id: { in: ids }, teacherId: actor.id, endedAt: null, section: { deletedAt: null } }, select: { id: true } });
  if (found.length !== ids.length) throw new AppError('FORBIDDEN', 403, 'You can only schedule classes for offerings you teach.');
}

async function scheduleJobs(c: { id: string; startAt: Date }): Promise<void> {
  if (!jobsRunning()) return;
  const remindAt = new Date(c.startAt.getTime() - REMIND_BEFORE_MIN * MIN);
  await enqueue('online_class.remind', { id: c.id, startAt: c.startAt.toISOString() }, { startAfter: remindAt > now() ? remindAt : now() });
}

export async function createOnlineClass(actor: Actor, b: OnlineClassCreateBody): Promise<{ id: string }> {
  const offeringIds = [...new Set(b.offeringIds)];
  await ownOfferings(actor, offeringIds);
  const startAt = new Date(b.startAt);
  if (startAt <= now()) throw bad('startAt', 'Choose a time in the future.');
  const c = await prisma.onlineClass.create({
    data: {
      teacherId: actor.id, title: b.title, topic: b.topic ?? null, description: b.description ?? null, startAt, durationMin: b.durationMin,
      platform: detectPlatform(b.joinUrl), joinUrl: b.joinUrl,
      offerings: { create: offeringIds.map((courseOfferingId) => ({ courseOfferingId })) },
    },
    select: { id: true },
  });
  await attachOrCreateMeetings({ id: c.id, startAt, durationMin: b.durationMin, teacherId: actor.id, offeringIds });
  await notifyBulk(await enrolledStudentIds(offeringIds), 'online_class_scheduled', { type: 'online_class', id: c.id }, `Online class "${b.title}" on ${when(startAt)}.`);
  await scheduleJobs({ id: c.id, startAt });
  return c;
}

async function loadOwned(actor: Actor, id: string) {
  const c = await prisma.onlineClass.findUnique({ where: { id }, include: { offerings: { select: { courseOfferingId: true } } } });
  if (!c || c.teacherId !== actor.id) throw NOT_FOUND();
  return c;
}

export async function updateOnlineClass(actor: Actor, id: string, b: OnlineClassUpdateBody): Promise<void> {
  if (actor.role !== 'teacher') throw new AppError('FORBIDDEN', 403, 'Only the class teacher can change it.');
  const c = await loadOwned(actor, id);
  const st = derivedStatus(c);
  if (st === 'cancelled' || st === 'ended') throw new AppError('CONFLICT', 409, 'This class is over or cancelled.');
  const startAt = b.startAt ? new Date(b.startAt) : c.startAt;
  if (b.startAt && startAt <= now()) throw bad('startAt', 'Choose a time in the future.');
  const durationMin = b.durationMin ?? c.durationMin;
  const retimed = startAt.getTime() !== c.startAt.getTime() || durationMin !== c.durationMin;
  const data: Prisma.OnlineClassUpdateInput = {
    ...(b.title !== undefined && { title: b.title }),
    ...(b.topic !== undefined && { topic: b.topic }),
    ...(b.description !== undefined && { description: b.description }),
    ...(b.joinUrl !== undefined && { joinUrl: b.joinUrl, platform: detectPlatform(b.joinUrl) }),
    startAt,
    durationMin,
    status: 'scheduled',
  };
  await prisma.onlineClass.update({ where: { id }, data });
  const offeringIds = c.offerings.map((o) => o.courseOfferingId);
  if (retimed) {
    await detachOnlineClass(id);
    await attachOrCreateMeetings({ id, startAt, durationMin, teacherId: c.teacherId, offeringIds });
    await scheduleJobs({ id, startAt });
  }
  const text = retimed ? `Online class "${b.title ?? c.title}" moved to ${when(startAt)}.` : `Online class "${b.title ?? c.title}" was updated.`;
  await notifyBulk(await enrolledStudentIds(offeringIds), 'online_class_changed', { type: 'online_class', id }, text);
}

export async function cancelOnlineClass(actor: Actor, id: string): Promise<void> {
  if (actor.role !== 'teacher') throw new AppError('FORBIDDEN', 403, 'Only the class teacher can cancel it.');
  const c = await loadOwned(actor, id);
  if (c.status === 'cancelled') return;
  await prisma.onlineClass.update({ where: { id }, data: { status: 'cancelled' } });
  await detachOnlineClass(id);
  await notifyBulk(await enrolledStudentIds(c.offerings.map((o) => o.courseOfferingId)), 'online_class_cancelled', { type: 'online_class', id }, `Online class "${c.title}" was cancelled.`);
}

// ───── reads ─────
export async function listOnlineClasses(actor: Actor, q: { offeringId?: string; status?: Status }) {
  let where: Prisma.OnlineClassWhereInput;
  let mine: Set<string> | null = null;
  if (actor.role === 'student') {
    const { offeringIds } = await studentScope(actor.id);
    mine = new Set(offeringIds);
    where = { offerings: { some: { courseOfferingId: { in: offeringIds } } } };
  } else if (actor.role === 'teacher') {
    const mentored = await mentoredOfferingIds(actor.id);
    where = { OR: [{ teacherId: actor.id }, { offerings: { some: { courseOfferingId: { in: mentored } } } }] };
  } else where = {};
  if (q.offeringId) where = { AND: [where, { offerings: { some: { courseOfferingId: q.offeringId } } }] };
  const rows = await prisma.onlineClass.findMany({
    where,
    orderBy: { startAt: 'desc' },
    take: 200,
    include: {
      teacher: { select: { name: true } },
      offerings: { select: { courseOfferingId: true, courseOffering: { select: { course: { select: { name: true } }, section: { select: { name: true, classLevel: true } } } } } },
    },
  });
  const t = now();
  const out = rows.map((c) => {
    const status = derivedStatus(c, t);
    // The link goes only to people who may join: enrolled students, the class teacher, mentors, the Admin (LRN-01).
    const showLink = mine ? c.offerings.some((o) => mine!.has(o.courseOfferingId)) : true;
    return {
      id: c.id, title: c.title, topic: c.topic, description: c.description, startAt: c.startAt, durationMin: c.durationMin,
      platform: c.platform, status, teacher: c.teacher.name,
      offerings: c.offerings.map((o) => ({ id: o.courseOfferingId, course: o.courseOffering.course.name, section: `${o.courseOffering.section.classLevel}${o.courseOffering.section.name}` })),
      ...(showLink ? { joinUrl: c.joinUrl } : {}),
      joinOpen: status === 'live' || (status === 'scheduled' && t.getTime() >= c.startAt.getTime() - JOIN_OPENS_BEFORE_MIN * MIN),
    };
  });
  return { items: q.status ? out.filter((c) => c.status === q.status) : out };
}

export async function joinOnlineClass(actor: Actor, id: string): Promise<{ joinUrl: string }> {
  if (actor.role !== 'student') throw new AppError('FORBIDDEN', 403, 'Only students join from here.');
  const c = await prisma.onlineClass.findUnique({ where: { id }, include: { offerings: { select: { courseOfferingId: true } } } });
  const { offeringIds } = await studentScope(actor.id);
  const mine = new Set(offeringIds);
  if (!c || !c.offerings.some((o) => mine.has(o.courseOfferingId))) throw NOT_FOUND();
  const t = now();
  const opensAt = c.startAt.getTime() - JOIN_OPENS_BEFORE_MIN * MIN;
  const closesAt = c.startAt.getTime() + c.durationMin * MIN;
  if (c.status === 'cancelled' || t.getTime() < opensAt || t.getTime() >= closesAt)
    throw new AppError('JOIN_NOT_OPEN', 409, 'You can join from 10 minutes before the class until it ends.');
  await prisma.onlineClassJoin.create({ data: { onlineClassId: id, studentId: actor.id, clickedJoinAt: t } });
  return { joinUrl: c.joinUrl };
}

export async function listJoins(actor: Actor, id: string) {
  if (actor.role === 'student') throw NOT_FOUND();
  const c = await prisma.onlineClass.findUnique({ where: { id }, include: { offerings: { select: { courseOfferingId: true } } } });
  if (!c) throw NOT_FOUND();
  if (actor.role === 'teacher' && c.teacherId !== actor.id) {
    const mentored = new Set(await mentoredOfferingIds(actor.id));
    if (!c.offerings.some((o) => mentored.has(o.courseOfferingId))) throw NOT_FOUND();
  }
  const joins = await prisma.onlineClassJoin.findMany({
    where: { onlineClassId: id },
    orderBy: { clickedJoinAt: 'asc' },
    include: { student: { select: { name: true, roll: true } } },
  });
  return { items: joins.map((j) => ({ studentId: j.studentId, name: j.student.name, roll: j.student.roll, clickedJoinAt: j.clickedJoinAt })) };
}

// ───── jobs ─────
/** Reminder at start − 15 min. Skipped when the class moved or was cancelled since the job was queued. */
export async function remindOnlineClass(id: string, startAtIso: string): Promise<boolean> {
  const c = await prisma.onlineClass.findUnique({ where: { id }, include: { offerings: { select: { courseOfferingId: true } } } });
  if (!c || c.status === 'cancelled' || c.startAt.toISOString() !== startAtIso) return false;
  await notifyBulk(await enrolledStudentIds(c.offerings.map((o) => o.courseOfferingId)), 'online_class_starting', { type: 'online_class', id }, `Online class "${c.title}" starts at ${formatDhaka(c.startAt, 'h:mm a')}.`);
  return true;
}

/** Persists the derived status (live / ended) for reports; reads never depend on it. */
export async function sweepOnlineStatuses(): Promise<void> {
  const t = now();
  await prisma.$executeRaw`UPDATE online_classes SET status = 'ended' WHERE status IN ('scheduled','live') AND start_at + (duration_min * interval '1 minute') <= ${t}`;
  await prisma.$executeRaw`UPDATE online_classes SET status = 'live' WHERE status = 'scheduled' AND start_at <= ${t}`;
}
