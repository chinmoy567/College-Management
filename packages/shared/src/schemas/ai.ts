import { z } from 'zod';
import { TEXT_LIMITS } from '../constants';
import { id } from './common';

export const aiConversationCreateBody = z.object({ title: z.string().trim().min(1).max(60).optional() });
export const aiMessageBody = z.object({
  content: z.string().trim().min(1).max(TEXT_LIMITS.aiPrompt),
  courseId: id.optional(),
});
export type AiMessageBody = z.infer<typeof aiMessageBody>;
export const aiUsageQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const AI_DISCLAIMER = 'AI may make mistakes, verify with your teacher.';
export const AI_BUSY_MESSAGE = 'The AI assistant is busy, please try again later.';
