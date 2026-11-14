import type { Exam } from '@prisma/client';
import { prisma } from '../../db';
import { AppError } from '../../lib/http';
import { permissionsFor } from '../../lib/permissions';
import type { AuthedRequest } from '../../middleware/session';

export type ExamWithOffering = Exam & { courseOffering: { id: string; teacherId: string; sectionId: string; courseId: string; endedAt: Date | null } };
const include = { courseOffering: { select: { id: true, teacherId: true, sectionId: true, courseId: true, endedAt: true } } } as const;

export async function loadExam(examId: string): Promise<ExamWithOffering> {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include });
  if (!exam) throw new AppError('NOT_FOUND', 404, 'Exam not found.');
  return exam;
}

/**
 * Manage an exam: only the course teacher of its offering (05 §1). The Admin gets 403 (cannot create or manage exams,
 * PRD §2.1); any other teacher gets 404 so they cannot tell the exam exists (CONV-09).
 */
export async function examForOwner(req: unknown, examId: string): Promise<ExamWithOffering> {
  const r = req as AuthedRequest;
  if (r.actor.role !== 'teacher') throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  const exam = await loadExam(examId);
  if (exam.courseOffering.teacherId !== r.user.id) throw new AppError('NOT_FOUND', 404, 'Exam not found.');
  return exam;
}

/** View results: the offering's teacher, the Section Mentor of its section, or the Admin. Others get 404 (students 403). */
export async function examForViewer(req: unknown, examId: string): Promise<ExamWithOffering> {
  const r = req as AuthedRequest;
  if (r.actor.role === 'student') throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  const exam = await loadExam(examId);
  if (r.actor.role === 'admin') return exam;
  if (exam.courseOffering.teacherId === r.user.id) return exam;
  if (await permissionsFor(req as AuthedRequest).mentorsSection(r.actor, exam.courseOffering.sectionId)) return exam;
  throw new AppError('NOT_FOUND', 404, 'Exam not found.');
}

/** Same rule for an offering (progress views). */
export async function offeringForViewer(req: unknown, offeringId: string) {
  const r = req as AuthedRequest;
  if (r.actor.role === 'student') throw new AppError('FORBIDDEN', 403, 'Not allowed.');
  const o = await prisma.courseOffering.findUnique({ where: { id: offeringId }, include: { course: true, section: true } });
  if (!o) throw new AppError('NOT_FOUND', 404, 'Course not found.');
  if (r.actor.role === 'admin' || o.teacherId === r.user.id) return o;
  if (await permissionsFor(r).mentorsSection(r.actor, o.sectionId)) return o;
  throw new AppError('NOT_FOUND', 404, 'Course not found.');
}
