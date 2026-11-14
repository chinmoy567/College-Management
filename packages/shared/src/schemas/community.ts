import { z } from 'zod';
import { MAX_IMAGES, TEXT_LIMITS } from '../constants';
import { id } from './common';

export const POST_TAGS = ['general', 'problem', 'study', 'event'] as const;
export const REACTION_TYPES = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const;
export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'] as const;
export const REPORT_TARGETS = ['post', 'comment', 'message', 'user'] as const;
export const MODERATION_ACTIONS = ['dismiss', 'delete', 'delete_warn', 'mute', 'approve'] as const;
export const SEEN_BATCH_MAX = 50;
export const PIN_EXTEND_MAX_DAYS = 30;
export const MUTE_MAX_DAYS = 365;
export const FEED_PINNED_EXPANDED = 5;

/** Multipart fields arrive as strings; `"true"` / `"1"` mean true, anything else false. */
const boolish = z.preprocess((v) => (typeof v === 'string' ? v === 'true' || v === '1' : v), z.boolean());
const asArray = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const link = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const p = new URL(v).protocol;
      return p === 'http:' || p === 'https:';
    } catch {
      return false;
    }
  }, 'Enter a link starting with http:// or https://');
/** An empty string clears the link. */
const optionalLink = z.preprocess((v) => (v === '' ? null : v), link.nullable().optional());

export const postCreateBody = z.object({
  text: z.string().trim().min(1, 'Write something').max(TEXT_LIMITS.post),
  tag: z.enum(POST_TAGS).default('general'),
  linkUrl: optionalLink,
  pin: boolish.optional(),
});
export type PostCreateBody = z.infer<typeof postCreateBody>;

/** No pin fields on purpose: editing never changes a pin (COMM-04). */
export const postPatchBody = z.object({
  text: z.string().trim().min(1).max(TEXT_LIMITS.post).optional(),
  tag: z.enum(POST_TAGS).optional(),
  linkUrl: optionalLink,
  removeMediaIds: z.preprocess(asArray, z.array(id).max(MAX_IMAGES)).default([]),
  removePdf: boolish.optional(),
});
export type PostPatchBody = z.infer<typeof postPatchBody>;

export const commentCreateBody = z.object({
  text: z.string().trim().min(1, 'Write something').max(TEXT_LIMITS.comment),
  parentCommentId: id.optional(),
  linkUrl: optionalLink,
});
export const commentPatchBody = z.object({
  text: z.string().trim().min(1).max(TEXT_LIMITS.comment).optional(),
  linkUrl: optionalLink,
  removeMediaIds: z.preprocess(asArray, z.array(id).max(MAX_IMAGES)).default([]),
  removePdf: boolish.optional(),
});

export const feedQuery = z.object({
  cursor: z.string().max(200).optional(),
  tag: z.enum(POST_TAGS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const seenBody = z.object({ postIds: z.array(id).min(1).max(SEEN_BATCH_MAX) });
export const pinExtendBody = z.object({ days: z.number().int().min(1).max(PIN_EXTEND_MAX_DAYS) });
export const reactionBody = z.object({ type: z.enum(REACTION_TYPES) });

export const reportBody = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: id,
    reason: z.enum(REPORT_REASONS),
    text: z.string().trim().max(500).optional(),
  })
  .strict();
export type ReportBody = z.infer<typeof reportBody>;

export const moderationQuery = z.object({
  status: z.enum(['open', 'dismissed', 'actioned']).default('open'),
  type: z.enum(['post', 'comment', 'message', 'user', 'held']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const moderationActionBody = z
  .object({
    action: z.enum(MODERATION_ACTIONS),
    days: z.number().int().min(1).max(MUTE_MAX_DAYS).optional(),
    reason: z.string().trim().min(1, 'Give a reason').max(500),
  })
  .refine((b) => b.action !== 'mute' || b.days !== undefined, { message: 'Choose how many days', path: ['days'] });
export type ModerationActionBody = z.infer<typeof moderationActionBody>;

export const bannedWordBody = z.object({ word: z.string().trim().min(1).max(60) });
export const bannedWordsToggleBody = z.object({ enabled: z.boolean() });
