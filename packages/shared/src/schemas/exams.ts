import { z } from 'zod';
import { EXAM_DURATIONS } from '../constants';
import { id } from './common';

/** Marks: 0.5 steps, 0.5 to 100 (05 §2). Right = marks, wrong/unanswered = 0, no negative or partial marks. */
export const marksSchema = z
  .number()
  .min(0.5, 'At least 0.5')
  .max(100, 'At most 100')
  .refine((v) => Math.round(v * 2) === v * 2, 'Marks go in steps of 0.5');

export const QUESTION_TYPES = ['single', 'multiple'] as const;
export const EXAM_KINDS = ['exam', 'quiz'] as const;
export const RESULT_MODES = ['instant', 'manual'] as const;
export const INTEGRITY_TYPES = ['blur', 'focus', 'fullscreen_exit', 'visibility_hidden'] as const;
export const OPTION_MIN = 2;
export const OPTION_MAX = 6;
export const INTEGRITY_CAP = 500;
export const SUBMIT_GRACE_SECONDS = 5;

/** `single` needs exactly one correct option, `multiple` at least one; indexes must be distinct and in range. */
export function checkQuestionShape(q: { type: 'single' | 'multiple'; optionCount: number; correct: number[] }): string | null {
  if (q.optionCount < OPTION_MIN || q.optionCount > OPTION_MAX) return `A question has ${OPTION_MIN} to ${OPTION_MAX} options`;
  if (new Set(q.correct).size !== q.correct.length) return 'Correct options must be different';
  if (q.correct.some((i) => i < 0 || i >= q.optionCount)) return 'A correct option does not exist';
  if (q.type === 'single' && q.correct.length !== 1) return 'A single-answer question has exactly one correct option';
  if (q.type === 'multiple' && q.correct.length < 1) return 'Choose at least one correct option';
  return null;
}

const optionText = z.object({ text: z.string().trim().min(1, 'Option text is required').max(500) });
const questionFields = {
  chapterId: id.nullish(),
  type: z.enum(QUESTION_TYPES),
  text: z.string().trim().min(1, 'Question text is required').max(2000),
  options: z.array(optionText).min(OPTION_MIN).max(OPTION_MAX),
  correct: z.array(z.number().int().min(0)).min(1),
  marks: marksSchema.default(1),
};
const shapeRule = (q: { type: 'single' | 'multiple'; options: unknown[]; correct: number[] }, ctx: z.RefinementCtx) => {
  const msg = checkQuestionShape({ type: q.type, optionCount: q.options.length, correct: q.correct });
  if (msg) ctx.addIssue({ code: 'custom', message: msg, path: ['correct'] });
};

export const questionBody = z.object({ courseId: id, ...questionFields }).superRefine(shapeRule);
export const inlineQuestionBody = z.object(questionFields).superRefine(shapeRule);
/** Patch is merged with the stored question and re-checked by the service with `checkQuestionShape`. */
export const questionPatchBody = z.object({ ...questionFields, marks: marksSchema }).partial();
export const bankQuery = z.object({
  courseId: id,
  chapterId: id.optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const durationSchema = z
  .number()
  .int()
  .refine((n) => (EXAM_DURATIONS as readonly number[]).includes(n), `Duration must be one of ${EXAM_DURATIONS.join(', ')} minutes`);

const examFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  instructions: z.string().trim().max(5000).nullish(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  durationMin: durationSchema,
  passMarks: z.number().min(0).max(10000),
  maxAttempts: z.number().int().min(0).max(10).default(1),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  showAnswersAfterEnd: z.boolean().default(true),
  resultMode: z.enum(RESULT_MODES).default('instant'),
};
export const examCreateBody = z
  .object({ offeringId: id, kind: z.enum(EXAM_KINDS), ...examFields })
  .superRefine((e, ctx) => {
    if (e.endAt <= e.startAt) ctx.addIssue({ code: 'custom', message: 'End must be after start', path: ['endAt'] });
    if (e.kind === 'exam' && e.maxAttempts !== 1) ctx.addIssue({ code: 'custom', message: 'An exam allows exactly 1 attempt', path: ['maxAttempts'] });
  });
export const examQuestionsBody = z.object({
  items: z
    .array(z.union([z.object({ questionId: id }).strict(), z.object({ inline: inlineQuestionBody }).strict()]))
    .min(1)
    .max(300),
});

export const examPatchBody = z
  .object({ ...examFields, kind: z.enum(EXAM_KINDS), items: examQuestionsBody.shape.items })
  .partial()
  .strict();

export const answerBody = z.object({
  selectedOptionIds: z.array(z.string().regex(/^o[1-6]$/)).max(OPTION_MAX),
  markedForReview: z.boolean().default(false),
});
export const integrityBody = z.object({
  events: z
    .array(z.object({ type: z.enum(INTEGRITY_TYPES), at: z.coerce.date() }))
    .min(1)
    .max(100),
});
export const fixKeyBody = z.object({ correct: z.array(z.string().regex(/^o[1-6]$/)).min(1).max(OPTION_MAX) });
export const extendBody = z.object({ minutes: z.number().int().min(1).max(120), reopen: z.boolean().optional() });
export const myExamsQuery = z.object({
  status: z.enum(['upcoming', 'live', 'completed']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const examListQuery = z.object({
  offeringId: id,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const myProgressQuery = z.object({ courseId: id.optional() });
export const adminPerformanceQuery = z.object({ by: z.enum(['session', 'group', 'section', 'course']).default('session') });
