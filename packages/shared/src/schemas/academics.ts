import { z } from 'zod';
import { id } from './common';

/** "2024-25" or "2024–25"; stored with an en dash. */
export const SESSION_NAME = /^\d{4}[–-]\d{2}$/;
export const normaliseSessionName = (v: string): string => v.trim().replace('-', '–');
export const sessionName = z
  .string()
  .trim()
  .regex(SESSION_NAME, 'Use the format 2024–25')
  .transform(normaliseSessionName);

export const sessionBody = z.object({ name: sessionName });
export const closeSessionBody = z.object({ confirm: z.literal(true) });
export const sectionCreateBody = z.object({
  name: z.string().trim().min(1).max(20),
  classLevel: z.union([z.literal(11), z.literal(12)]),
});
export const sectionPatchBody = z
  .object({ name: z.string().trim().min(1).max(20).optional(), mentorTeacherId: id.nullable().optional() })
  .refine((v) => v.name !== undefined || v.mentorTeacherId !== undefined, 'Nothing to change');

export const courseBody = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  groupType: z.enum(['science', 'commerce', 'arts', 'common']),
  classLevel: z.enum(['c11', 'c12', 'both']),
  paper: z.enum(['first', 'second', 'none']).default('none'),
  isOptional: z.boolean().default(false),
});
export const coursePatchBody = courseBody.partial().extend({ archived: z.boolean().optional() });
export const chapterBody = z.object({ name: z.string().trim().min(1).max(200), order: z.number().int().min(0).optional() });
export const chapterPatchBody = z.object({ name: z.string().trim().min(1).max(200) });
export const chapterOrderBody = z.object({ ids: z.array(id).min(1).max(500) });

export const offeringItem = z.object({
  courseId: id,
  teacherId: id,
  optionalStudentIds: z.array(id).max(30).optional(),
});
export const offeringsPutBody = z.object({ items: z.array(offeringItem).max(60) });
export const offeringPatchBody = z.object({ teacherId: id });
export const offeringCopyBody = z.object({ fromSectionId: id });
export const offeringStudentsBody = z.object({ studentIds: z.array(id).max(30) });
