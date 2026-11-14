import { z } from 'zod';
import { id } from './common';

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => u.toLowerCase().startsWith('https://'), 'The link must start with https://');
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).max(max).optional());
const optId = z.preprocess((v) => (v === '' ? undefined : v), id.optional());

// ───── online classes (08 §1) ─────
export const onlineClassCreateBody = z.object({
  offeringIds: z.array(id).min(1).max(20),
  title: text(200),
  topic: optText(200),
  description: optText(2000),
  startAt: z.string().datetime({ offset: true }),
  durationMin: z.coerce.number().int().min(15).max(240),
  joinUrl: httpsUrl,
});
export type OnlineClassCreateBody = z.infer<typeof onlineClassCreateBody>;

export const onlineClassUpdateBody = z
  .object({
    title: text(200),
    topic: optText(200),
    description: optText(2000),
    startAt: z.string().datetime({ offset: true }),
    durationMin: z.coerce.number().int().min(15).max(240),
    joinUrl: httpsUrl,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.');
export type OnlineClassUpdateBody = z.infer<typeof onlineClassUpdateBody>;

export const onlineClassListQuery = z.object({
  offeringId: id.optional(),
  status: z.enum(['scheduled', 'live', 'ended', 'cancelled']).optional(),
});

// ───── recordings (08 §2) ─────
export const recordingCreateBody = z.object({
  courseOfferingId: id.optional(),
  courseId: id,
  chapterId: id.optional(),
  title: text(200),
  description: optText(2000),
  url: z.string().trim().min(1).max(2000),
  visibility: z.enum(['section', 'college']).default('section'),
});
export type RecordingCreateBody = z.infer<typeof recordingCreateBody>;

export const recordingUpdateBody = z
  .object({
    chapterId: id.nullable(),
    title: text(200),
    description: optText(2000),
    url: z.string().trim().min(1).max(2000),
    visibility: z.enum(['section', 'college']),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.');
export type RecordingUpdateBody = z.infer<typeof recordingUpdateBody>;

export const recordingListQuery = z.object({
  courseId: id.optional(),
  chapterId: id.optional(),
  q: z.string().trim().max(100).optional(),
  scope: z.enum(['mine', 'free']).optional(),
});

// ───── materials (08 §3), sent as multipart so every field arrives as a string ─────
export const MATERIAL_MAX_FILES = 10;
export const materialCreateBody = z.object({
  scope: z.enum(['offering', 'section', 'group', 'college']),
  courseOfferingId: optId,
  sectionId: optId,
  groupId: optId,
  courseId: optId,
  chapterId: optId,
  title: text(200),
  description: optText(2000),
  linkUrl: z.preprocess((v) => (v === '' ? undefined : v), httpsUrl.optional()),
});
export type MaterialCreateBody = z.infer<typeof materialCreateBody>;

export const materialUpdateBody = z
  .object({
    chapterId: id.nullable(),
    title: text(200),
    description: optText(2000),
    linkUrl: httpsUrl.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.');
export type MaterialUpdateBody = z.infer<typeof materialUpdateBody>;

export const materialListQuery = z.object({
  courseId: id.optional(),
  chapterId: id.optional(),
  scope: z.enum(['offering', 'section', 'group', 'college']).optional(),
});
export const materialFileQuery = z.object({ action: z.enum(['view', 'download']).default('view') });

// ───── previous-year questions (08 §4) ─────
export const PREV_EXAM_TYPES = ['hsc_board', 'test', 'pre_test', 'half_yearly', 'model_test'] as const;
export const prevQuestionCreateBody = z.object({
  courseId: id,
  year: z.coerce.number().int().min(1990).max(2100),
  examType: z.enum(PREV_EXAM_TYPES),
  board: optText(100),
});
export type PrevQuestionCreateBody = z.infer<typeof prevQuestionCreateBody>;
export const prevQuestionListQuery = z.object({
  courseId: id.optional(),
  year: z.coerce.number().int().min(1990).max(2100).optional(),
  examType: z.enum(PREV_EXAM_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
});
