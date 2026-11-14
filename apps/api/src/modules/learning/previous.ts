import type { Prisma } from '@prisma/client';
import type { PrevQuestionCreateBody } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { signMany, softDeleteObjects, type UploadedFile } from '../../lib/files';
import { AppError } from '../../lib/http';
import type { Actor } from '../../lib/permissions';
import { dhakaDate } from '../../lib/time';
import { NOT_FOUND, bad } from './common';
import { storeFiles } from './materials';

const MAX_FILES = 10;

/** Admin; a teacher who teaches the course; a mentor whose section has an offering of it (PRD §2.1). */
async function mayUpload(actor: Actor, courseId: string): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'teacher') return false;
  const hit = await prisma.courseOffering.findFirst({
    where: { courseId, endedAt: null, OR: [{ teacherId: actor.id }, { section: { mentorTeacherId: actor.id, deletedAt: null } }] },
    select: { id: true },
  });
  return !!hit;
}

export async function createPrevious(actor: Actor, b: PrevQuestionCreateBody, files: UploadedFile[], solution: UploadedFile | null): Promise<{ id: string }> {
  if (!(await mayUpload(actor, b.courseId))) throw new AppError('FORBIDDEN', 403, 'You can only upload questions for courses you teach.');
  if (b.year > Number(dhakaDate(now()).slice(0, 4)) + 1) throw bad('year', 'That year is too far ahead.');
  if (!files.length || files.length > MAX_FILES) throw bad('files', `Add 1 to ${MAX_FILES} files.`);
  if (solution && solution.buffer.subarray(0, 5).toString() !== '%PDF-') throw bad('solution', 'The solution must be a PDF.');
  for (const f of files) {
    const pdf = f.buffer.subarray(0, 5).toString() === '%PDF-';
    const ext = f.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!pdf && !['jpg', 'jpeg', 'png', 'webp'].includes(ext)) throw bad('files', 'Questions must be PDF or image files.');
  }
  const stored = await storeFiles(actor.id, 'previous_question', [...files, ...(solution ? [solution] : [])]);
  const solutionId = solution ? stored[stored.length - 1]! : null;
  const fileIds = solution ? stored.slice(0, -1) : stored;
  const q = await prisma.previousQuestion.create({
    data: { courseId: b.courseId, year: b.year, examType: b.examType, board: b.board ?? null, fileIds, solutionId, createdBy: actor.id },
    select: { id: true },
  });
  return q;
}

/** Students see courses of their group and class, plus common ones; everyone else sees all. */
async function previousWhere(actor: Actor): Promise<Prisma.PreviousQuestionWhereInput> {
  if (actor.role !== 'student') return { deletedAt: null };
  const p = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: actor.id }, select: { section: { select: { classLevel: true, group: { select: { type: true } } } } } });
  const cls = p.section.classLevel === 11 ? 'c11' : 'c12';
  return { deletedAt: null, course: { groupType: { in: [p.section.group.type, 'common'] }, classLevel: { in: [cls, 'both'] } } };
}

export async function listPrevious(actor: Actor, q: { courseId?: string; year?: number; examType?: string; q?: string }) {
  const and: Prisma.PreviousQuestionWhereInput[] = [await previousWhere(actor)];
  if (q.courseId) and.push({ courseId: q.courseId });
  if (q.year) and.push({ year: q.year });
  if (q.examType) and.push({ examType: q.examType as never });
  if (q.q) and.push({ OR: [{ board: { contains: q.q, mode: 'insensitive' } }, { course: { name: { contains: q.q, mode: 'insensitive' } } }] });
  const rows = await prisma.previousQuestion.findMany({
    where: { AND: and },
    orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
    take: 300,
    include: { course: { select: { name: true } } },
  });
  const ids = rows.flatMap((r) => r.fileIds);
  const objs = await prisma.storageObject.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, mime: true, originalName: true } });
  const byId = new Map(objs.map((o) => [o.id, o]));
  return {
    items: rows.map((r) => ({
      id: r.id, courseId: r.courseId, course: r.course.name, year: r.year, examType: r.examType, board: r.board, mine: r.createdBy === actor.id,
      files: r.fileIds.filter((f) => byId.has(f)).map((f) => ({ id: f, name: byId.get(f)!.originalName ?? 'image', mime: byId.get(f)!.mime })),
      solutionId: r.solutionId,
    })),
  };
}

export async function previousFileUrl(actor: Actor, id: string, objectId: string, action: 'view' | 'download'): Promise<string> {
  const q = await prisma.previousQuestion.findFirst({ where: { AND: [await previousWhere(actor), { id }] }, select: { fileIds: true, solutionId: true } });
  if (!q || (!q.fileIds.includes(objectId) && q.solutionId !== objectId)) throw NOT_FOUND();
  const o = await prisma.storageObject.findFirst({ where: { id: objectId, deletedAt: null }, select: { mime: true } });
  if (!o) throw NOT_FOUND();
  const inline = o.mime === 'application/pdf' || o.mime.startsWith('image/');
  const url = (await signMany([objectId], { download: action === 'download' || !inline })).get(objectId);
  if (!url) throw NOT_FOUND();
  return url;
}

async function loadManageable(actor: Actor, id: string) {
  const q = await prisma.previousQuestion.findFirst({ where: { id, deletedAt: null } });
  if (!q || (actor.role !== 'admin' && q.createdBy !== actor.id)) throw NOT_FOUND();
  return q;
}

export async function updatePrevious(actor: Actor, id: string, b: { year?: number; examType?: string; board?: string | null }): Promise<void> {
  await loadManageable(actor, id);
  await prisma.previousQuestion.update({
    where: { id },
    data: { ...(b.year !== undefined && { year: b.year }), ...(b.examType !== undefined && { examType: b.examType as never }), ...(b.board !== undefined && { board: b.board }) },
  });
}

export async function deletePrevious(actor: Actor, id: string): Promise<void> {
  const q = await loadManageable(actor, id);
  await prisma.$transaction(async (tx) => {
    await tx.previousQuestion.update({ where: { id }, data: { deletedAt: new Date() } });
    await softDeleteObjects([...q.fileIds, ...(q.solutionId ? [q.solutionId] : [])], tx);
  });
}
