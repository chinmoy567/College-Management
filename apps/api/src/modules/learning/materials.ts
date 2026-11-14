import type { Prisma } from '@prisma/client';
import { MATERIAL_MAX_FILES, type MaterialCreateBody, type MaterialUpdateBody } from '@cms/shared';
import { prisma } from '../../db';
import { signMany, softDeleteObjects, storeUpload, type UploadedFile } from '../../lib/files';
import { AppError } from '../../lib/http';
import { notifyBulk } from '../../lib/notify';
import { createPermissions, prismaPermissionStore, type Actor } from '../../lib/permissions';
import { enqueue, jobsRunning } from '../../jobs';
import { NOT_FOUND, bad, enrolledStudentIds, studentScope, teacherScope } from './common';

const perms = createPermissions(prismaPermissionStore);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

/** The kind is a hint from the name; processUpload then checks the real content, so a wrong hint just fails. */
export const kindOf = (name: string): 'image' | 'document' => (IMAGE_EXT.has(name.split('.').pop()?.toLowerCase() ?? '') ? 'image' : 'document');

/** Stores every file; if one fails, the ones already stored are marked deleted. */
export async function storeFiles(userId: string, purpose: 'material' | 'previous_question', files: UploadedFile[]): Promise<string[]> {
  const stored: string[] = [];
  try {
    for (const f of files) stored.push(await storeUpload(userId, purpose, kindOf(f.originalname), f));
  } catch (e) {
    await softDeleteObjects(stored);
    throw e;
  }
  return stored;
}

/** The single visibility rule for list, file access and stats (LRN-05). */
export async function materialWhere(actor: Actor): Promise<Prisma.MaterialWhereInput> {
  if (actor.role === 'admin') return { deletedAt: null };
  if (actor.role === 'student') {
    const s = await studentScope(actor.id);
    return {
      deletedAt: null,
      OR: [
        { scope: 'offering', courseOfferingId: { in: s.offeringIds } },
        { scope: 'section', sectionId: s.sectionId },
        { scope: 'group', groupId: s.groupId },
        { scope: 'college' },
      ],
    };
  }
  const t = await teacherScope(actor.id);
  return {
    deletedAt: null,
    OR: [
      { createdBy: actor.id },
      { scope: 'offering', courseOfferingId: { in: t.taughtOfferingIds } },
      { scope: 'offering', courseOffering: { sectionId: { in: t.mentoredSectionId ? [t.mentoredSectionId] : [] } } },
      { scope: 'section', sectionId: { in: t.sectionIds } },
      { scope: 'group', groupId: { in: t.groupIds } },
      { scope: 'college' },
    ],
  };
}

async function audienceOf(m: { scope: string; courseOfferingId: string | null; sectionId: string | null; groupId: string | null }): Promise<string[]> {
  if (m.scope === 'offering') return enrolledStudentIds(m.courseOfferingId ? [m.courseOfferingId] : []);
  const where: Prisma.StudentProfileWhereInput = { user: { status: 'active' }, passedOutAt: null };
  if (m.scope === 'section') where.sectionId = m.sectionId!;
  else if (m.scope === 'group') where.section = { groupId: m.groupId! };
  const rows = await prisma.studentProfile.findMany({ where, select: { userId: true } });
  return rows.map((r) => r.userId);
}

export async function createMaterial(actor: Actor, b: MaterialCreateBody, files: UploadedFile[]): Promise<{ id: string }> {
  if (actor.role === 'student') throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  if (files.length > MATERIAL_MAX_FILES) throw bad('files', `At most ${MATERIAL_MAX_FILES} files.`);
  if (!files.length && !b.linkUrl) throw bad('files', 'Add a file or a link.');

  let courseId = b.courseId ?? null;
  let courseOfferingId: string | null = null;
  let sectionId: string | null = null;
  let groupId: string | null = null;
  if (b.scope === 'offering') {
    if (!b.courseOfferingId) throw bad('courseOfferingId', 'Choose a course offering.');
    if (!(await perms.canManageOffering(actor, b.courseOfferingId, { mentorAllowed: false })))
      throw new AppError('FORBIDDEN', 403, 'You can only share notes for your own course offering.');
    const o = await prisma.courseOffering.findUniqueOrThrow({ where: { id: b.courseOfferingId }, select: { courseId: true } });
    courseId = o.courseId;
    courseOfferingId = b.courseOfferingId;
  } else if (b.scope === 'section') {
    if (!b.sectionId) throw bad('sectionId', 'Choose a section.');
    if (actor.role !== 'admin' && !(await perms.mentorsSection(actor, b.sectionId))) throw new AppError('FORBIDDEN', 403, 'Only the Section Mentor can share with the section.');
    if (!(await prisma.section.findFirst({ where: { id: b.sectionId, deletedAt: null }, select: { id: true } }))) throw bad('sectionId', 'Unknown section.');
    sectionId = b.sectionId;
  } else {
    if (actor.role !== 'admin') throw new AppError('FORBIDDEN', 403, 'Only the Admin can share with a group or the whole college.');
    if (b.scope === 'group') {
      if (!b.groupId || !(await prisma.group.findUnique({ where: { id: b.groupId }, select: { id: true } }))) throw bad('groupId', 'Choose a group.');
      groupId = b.groupId;
    }
  }
  if (courseId && !(await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }))) throw bad('courseId', 'Unknown course.');
  if (b.chapterId) {
    const ch = await prisma.chapter.findUnique({ where: { id: b.chapterId }, select: { courseId: true } });
    if (!courseId || !ch || ch.courseId !== courseId) throw bad('chapterId', 'That chapter does not belong to this course.');
  }

  const fileIds = await storeFiles(actor.id, 'material', files);
  const m = await prisma.material.create({
    data: {
      scope: b.scope, courseId, courseOfferingId, sectionId, groupId, chapterId: b.chapterId ?? null, title: b.title,
      description: b.description ?? null, linkUrl: b.linkUrl ?? null, createdBy: actor.id,
      files: { create: fileIds.map((fileId, order) => ({ fileId, order })) },
    },
    select: { id: true, files: { select: { id: true, fileId: true } } },
  });
  if (jobsRunning()) {
    const objs = await prisma.storageObject.findMany({ where: { id: { in: fileIds }, mime: 'application/pdf' }, select: { id: true } });
    const pdf = new Set(objs.map((o) => o.id));
    for (const f of m.files) if (pdf.has(f.fileId)) await enqueue('material.extract_text', { materialId: m.id, fileId: f.fileId });
  }
  await notifyBulk(await audienceOf({ scope: b.scope, courseOfferingId, sectionId, groupId }), 'material_new', { type: 'material', id: m.id }, `New study material: "${b.title}".`);
  return { id: m.id };
}

async function loadManageable(actor: Actor, id: string) {
  const m = await prisma.material.findFirst({ where: { id, deletedAt: null }, include: { files: { select: { fileId: true } } } });
  if (!m || (actor.role !== 'admin' && m.createdBy !== actor.id)) throw NOT_FOUND();
  return m;
}

export async function updateMaterial(actor: Actor, id: string, b: MaterialUpdateBody): Promise<void> {
  const m = await loadManageable(actor, id);
  if (b.chapterId) {
    const ch = await prisma.chapter.findUnique({ where: { id: b.chapterId }, select: { courseId: true } });
    if (!m.courseId || !ch || ch.courseId !== m.courseId) throw bad('chapterId', 'That chapter does not belong to this course.');
  }
  await prisma.material.update({
    where: { id },
    data: {
      ...(b.title !== undefined && { title: b.title }),
      ...(b.description !== undefined && { description: b.description }),
      ...(b.chapterId !== undefined && { chapterId: b.chapterId }),
      ...(b.linkUrl !== undefined && { linkUrl: b.linkUrl }),
    },
  });
}

export async function deleteMaterial(actor: Actor, id: string): Promise<void> {
  const m = await loadManageable(actor, id);
  await prisma.$transaction(async (tx) => {
    await tx.material.update({ where: { id }, data: { deletedAt: new Date() } });
    await softDeleteObjects(m.files.map((f) => f.fileId), tx);
  });
}

export async function listMaterials(actor: Actor, q: { courseId?: string; chapterId?: string; scope?: 'offering' | 'section' | 'group' | 'college' }) {
  const and: Prisma.MaterialWhereInput[] = [await materialWhere(actor)];
  if (q.courseId) and.push({ courseId: q.courseId });
  if (q.chapterId) and.push({ chapterId: q.chapterId });
  if (q.scope) and.push({ scope: q.scope });
  const rows = await prisma.material.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
    include: {
      course: { select: { name: true } },
      chapter: { select: { name: true, order: true } },
      files: { orderBy: { order: 'asc' }, select: { id: true, file: { select: { mime: true, originalName: true, size: true, deletedAt: true } } } },
    },
  });
  return {
    items: rows.map((m) => ({
      id: m.id, scope: m.scope, title: m.title, description: m.description, linkUrl: m.linkUrl,
      courseId: m.courseId, course: m.course?.name ?? null, chapterId: m.chapterId, chapter: m.chapter?.name ?? null, chapterOrder: m.chapter?.order ?? null,
      createdAt: m.createdAt, mine: m.createdBy === actor.id,
      files: m.files.filter((f) => !f.file.deletedAt).map((f) => ({ id: f.id, name: f.file.originalName ?? 'image', mime: f.file.mime, size: f.file.size, inline: isInline(f.file.mime) })),
    })),
  };
}

/** PDFs and (re-encoded) images show in the browser; Office files always download. */
const isInline = (mime: string): boolean => mime === 'application/pdf' || mime.startsWith('image/');

/** Permission check → MaterialView row → a 5-minute signed URL (never the bytes). */
export async function materialFileUrl(actor: Actor, materialId: string, fileId: string, action: 'view' | 'download'): Promise<string> {
  const m = await prisma.material.findFirst({
    where: { AND: [await materialWhere(actor), { id: materialId }] },
    select: { id: true, files: { where: { id: fileId }, select: { file: { select: { id: true, mime: true, deletedAt: true } } } } },
  });
  const f = m?.files[0]?.file;
  if (!m || !f || f.deletedAt) throw NOT_FOUND();
  const download = action === 'download' || !isInline(f.mime);
  await prisma.materialView.create({ data: { materialId, userId: actor.id, action: download ? 'download' : 'view' } });
  const url = (await signMany([f.id], { download })).get(f.id);
  if (!url) throw NOT_FOUND();
  return url;
}

export async function materialStats(actor: Actor, id: string) {
  await loadManageable(actor, id);
  const rows = await prisma.materialView.groupBy({ by: ['action'], where: { materialId: id }, _count: { _all: true } });
  const uniq = await prisma.materialView.groupBy({ by: ['action', 'userId'], where: { materialId: id } });
  const out = { views: 0, downloads: 0, uniqueViewers: 0, uniqueDownloaders: 0 };
  for (const r of rows) {
    if (r.action === 'view') out.views = r._count._all;
    else out.downloads = r._count._all;
  }
  for (const u of uniq) {
    if (u.action === 'view') out.uniqueViewers++;
    else out.uniqueDownloaders++;
  }
  return out;
}
