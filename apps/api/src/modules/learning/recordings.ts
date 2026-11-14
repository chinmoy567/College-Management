import type { Prisma } from '@prisma/client';
import type { RecordingCreateBody, RecordingUpdateBody } from '@cms/shared';
import { prisma } from '../../db';
import { AppError } from '../../lib/http';
import { notifyBulk } from '../../lib/notify';
import { createPermissions, prismaPermissionStore, type Actor } from '../../lib/permissions';
import { NOT_FOUND, bad, enrolledStudentIds, mentoredOfferingIds, studentScope, teacherScope } from './common';
import { embedUrl, parseVideoUrl } from './videoUrl';

const perms = createPermissions(prismaPermissionStore);

function parseOrThrow(url: string) {
  const v = parseVideoUrl(url);
  if (!v) throw new AppError('UNSUPPORTED_VIDEO_URL', 400, 'Use a YouTube or Google Drive video link.', { url: 'Unsupported link' });
  return v;
}

async function checkChapter(courseId: string, chapterId: string | undefined | null): Promise<void> {
  if (!chapterId) return;
  const ch = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { courseId: true } });
  if (!ch || ch.courseId !== courseId) throw bad('chapterId', 'That chapter does not belong to this course.');
}

export async function createRecording(actor: Actor, b: RecordingCreateBody): Promise<{ id: string }> {
  if (actor.role === 'student') throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  const video = parseOrThrow(b.url);
  const course = await prisma.course.findUnique({ where: { id: b.courseId }, select: { id: true } });
  if (!course) throw bad('courseId', 'Unknown course.');
  let offeringId: string | null = null;
  if (b.courseOfferingId) {
    const o = await prisma.courseOffering.findUnique({ where: { id: b.courseOfferingId }, select: { courseId: true, endedAt: true } });
    if (!o || o.courseId !== b.courseId) throw bad('courseOfferingId', 'This offering is not for that course.');
    if (!(await perms.canManageOffering(actor, b.courseOfferingId, { mentorAllowed: true }))) throw new AppError('FORBIDDEN', 403, 'You can only add recordings to your own course or section.');
    offeringId = b.courseOfferingId;
  } else {
    // No offering means a college-wide library item: Admin only.
    if (actor.role !== 'admin') throw new AppError('FORBIDDEN', 403, 'Choose one of your course offerings.');
    if (b.visibility !== 'college') throw bad('visibility', 'Without an offering the recording is free for all students.');
  }
  await checkChapter(b.courseId, b.chapterId);
  const r = await prisma.recordedClass.create({
    data: {
      courseId: b.courseId, courseOfferingId: offeringId, chapterId: b.chapterId ?? null, title: b.title, description: b.description ?? null,
      videoSource: video.source, url: b.url, videoId: video.videoId, visibility: b.visibility, createdBy: actor.id,
    },
    select: { id: true },
  });
  // The offering's enrolled students are told either way; a college item adds no one else.
  if (offeringId) await notifyBulk(await enrolledStudentIds([offeringId]), 'recording_new', { type: 'recording', id: r.id }, `New recorded class: "${b.title}".`);
  return r;
}

async function loadManageable(actor: Actor, id: string) {
  const r = await prisma.recordedClass.findFirst({ where: { id, deletedAt: null } });
  if (!r || (actor.role !== 'admin' && r.createdBy !== actor.id)) throw NOT_FOUND();
  return r;
}

export async function updateRecording(actor: Actor, id: string, b: RecordingUpdateBody): Promise<void> {
  const r = await loadManageable(actor, id);
  const video = b.url ? parseOrThrow(b.url) : null;
  if (b.chapterId) await checkChapter(r.courseId, b.chapterId);
  if (b.visibility === 'section' && !r.courseOfferingId) throw bad('visibility', 'A college library item must stay free for all.');
  await prisma.recordedClass.update({
    where: { id },
    data: {
      ...(b.title !== undefined && { title: b.title }),
      ...(b.description !== undefined && { description: b.description }),
      ...(b.chapterId !== undefined && { chapterId: b.chapterId }),
      ...(b.visibility !== undefined && { visibility: b.visibility }),
      ...(video && { url: b.url!, videoSource: video.source, videoId: video.videoId }),
    },
  });
}

export async function deleteRecording(actor: Actor, id: string): Promise<void> {
  await loadManageable(actor, id);
  await prisma.recordedClass.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** One visibility rule for list and "opened", so they cannot disagree. */
async function recordingWhere(actor: Actor): Promise<Prisma.RecordedClassWhereInput> {
  if (actor.role === 'admin') return { deletedAt: null };
  if (actor.role === 'student') {
    const { offeringIds } = await studentScope(actor.id);
    return { deletedAt: null, OR: [{ courseOfferingId: { in: offeringIds } }, { visibility: 'college' }] };
  }
  const s = await teacherScope(actor.id);
  const mentored = await mentoredOfferingIds(actor.id);
  return { deletedAt: null, OR: [{ createdBy: actor.id }, { courseOfferingId: { in: [...s.taughtOfferingIds, ...mentored] } }, { visibility: 'college' }] };
}

export async function listRecordings(actor: Actor, q: { courseId?: string; chapterId?: string; q?: string; scope?: 'mine' | 'free' }) {
  const base = await recordingWhere(actor);
  const and: Prisma.RecordedClassWhereInput[] = [base];
  if (q.courseId) and.push({ courseId: q.courseId });
  if (q.chapterId) and.push({ chapterId: q.chapterId });
  if (q.q) and.push({ OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] });
  if (q.scope === 'free') and.push({ visibility: 'college' });
  if (q.scope === 'mine' && actor.role === 'student') {
    const { offeringIds } = await studentScope(actor.id);
    and.push({ courseOfferingId: { in: offeringIds } });
  }
  const rows = await prisma.recordedClass.findMany({
    where: { AND: and },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: {
      course: { select: { name: true } },
      chapter: { select: { name: true, order: true } },
      ...(actor.role === 'student' ? { progress: { where: { studentId: actor.id }, select: { firstOpenedAt: true } } } : {}),
    },
  });
  return {
    items: rows.map((r) => ({
      id: r.id, title: r.title, description: r.description, courseId: r.courseId, course: r.course.name,
      chapterId: r.chapterId, chapter: r.chapter?.name ?? null, visibility: r.visibility, source: r.videoSource, url: r.url,
      embedUrl: embedUrl(r.videoSource, r.videoId!), createdAt: r.createdAt, mine: r.createdBy === actor.id,
      ...(actor.role === 'student' ? { watched: ((r as { progress?: unknown[] }).progress?.length ?? 0) > 0 } : {}),
    })),
  };
}

export async function markOpened(actor: Actor, id: string): Promise<void> {
  if (actor.role !== 'student') throw new AppError('FORBIDDEN', 403, 'Only students have watch progress.');
  const where = await recordingWhere(actor);
  const r = await prisma.recordedClass.findFirst({ where: { AND: [where, { id }] }, select: { id: true } });
  if (!r) throw NOT_FOUND();
  await prisma.recordingProgress.upsert({
    where: { recordedClassId_studentId: { recordedClassId: id, studentId: actor.id } },
    create: { recordedClassId: id, studentId: actor.id },
    update: { lastOpenedAt: new Date() },
  });
}
