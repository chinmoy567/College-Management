import { z } from 'zod';
import { TEXT_LIMITS } from '../constants';
import { id } from './common';

export const NOTICE_PRIORITIES = ['normal', 'important', 'urgent'] as const;
export const NOTICE_ROLES = ['student', 'teacher'] as const;
export const NOTIFICATION_TYPES = [
  'notice_new', 'online_class_scheduled', 'online_class_starting', 'online_class_changed', 'online_class_cancelled',
  'recording_new', 'material_new', 'exam_published', 'exam_starting_soon', 'result_published', 'exam_key_fixed',
  'pinned_post', 'reaction', 'comment', 'reply', 'new_message', 'course_assignment_changed', 'mentor_assigned',
  'marked_absent', 'attendance_below_threshold', 'routine_changed', 'class_cancelled', 'substitute_assigned',
  'content_removed', 'warning', 'muted',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const messageBody = z
  .object({
    text: z.string().trim().max(TEXT_LIMITS.message).optional(),
    attachmentId: id.optional(),
    clientId: z.string().min(1).max(64).optional(),
  })
  .refine((b) => !!b.text || !!b.attachmentId, { message: 'Write a message or attach a file', path: ['text'] });
export type MessageBody = z.infer<typeof messageBody>;

export const socketSend = z.object({ conversationId: id, clientId: z.string().min(1).max(64), text: z.string().trim().max(TEXT_LIMITS.message).optional(), attachmentId: id.optional() });
export const socketTyping = z.object({ conversationId: id });
export const socketRead = z.object({ conversationId: id, messageId: id });

export const directBody = z.object({ userId: id });
export const blockBody = z.object({ userId: id });
export const messagesQuery = z.object({
  before: id.optional(),
  after: id.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

/** Central: AND between keys, OR within a list. Class-wise: offerings and/or sections. */
export const noticeAudience = z.object({
  all: z.boolean().optional(),
  roles: z.array(z.enum(NOTICE_ROLES)).min(1).optional(),
  sessionIds: z.array(id).min(1).optional(),
  groupIds: z.array(id).min(1).optional(),
  offeringIds: z.array(id).min(1).optional(),
  sectionIds: z.array(id).min(1).optional(),
});
export type NoticeAudience = z.infer<typeof noticeAudience>;

const jsonField = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' ? safeJson(v) : v), s);
const safeJson = (v: string): unknown => {
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
};
const boolish = z.preprocess((v) => (typeof v === 'string' ? v === 'true' || v === '1' : v), z.boolean());
const isoDate = z.preprocess((v) => (v === '' ? undefined : v), z.coerce.date().optional());

export const noticeCreateBody = z.object({
  scope: z.enum(['central', 'class']),
  audience: jsonField(noticeAudience),
  title: z.string().trim().min(1, 'Add a title').max(200),
  bodyHtml: z.string().min(1, 'Write the notice').max(TEXT_LIMITS.noticeBody),
  priority: z.enum(NOTICE_PRIORITIES).default('normal'),
  publishAt: isoDate,
  expiresAt: isoDate,
  showOnLanding: boolish.optional(),
});
export type NoticeCreateBody = z.infer<typeof noticeCreateBody>;

export const noticeUpdateBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  bodyHtml: z.string().min(1).max(TEXT_LIMITS.noticeBody).optional(),
  priority: z.enum(NOTICE_PRIORITIES).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});
export const noticeListQuery = z.object({
  filter: z.enum(['central', 'class']).optional(),
  unread: boolish.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const notificationsReadBody = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(id).min(1).max(100) })]);
export const notificationPrefsBody = z.object({
  prefs: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), email: z.boolean(), push: z.boolean() })).max(NOTIFICATION_TYPES.length),
});
export const pushSubscribeBody = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }) });
export const pushUnsubscribeBody = z.object({ endpoint: z.string().url().max(1000) });
