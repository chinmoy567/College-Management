import { ApiError } from './api';

export interface Author { id: string | null; name: string; avatarUrl: string | null; role: 'admin' | 'teacher' | 'student' | null; line: string | null }
export interface Pin { badge: string; until: string; audience: 'all' | 'section' }
export interface PostData {
  id: string; author: Author; text: string; tag: 'general' | 'problem' | 'study' | 'event'; link: string | null;
  status: 'published' | 'held' | 'removed';
  media: { id: string; signedUrl: string | null }[];
  pdf: { signedUrl: string | null; name: string; size: number } | null;
  reactionCounts: Record<string, number>; myReaction: string | null; commentCount: number;
  editedAt: string | null; createdAt: string; pin?: Pin;
}
export interface CommentData {
  id: string; postId: string; parentCommentId: string | null; author: Author; text: string; link: string | null;
  status: 'published' | 'held' | 'removed';
  media: { id: string; signedUrl: string | null }[];
  pdf: { id: string; signedUrl: string | null; name: string; size: number } | null;
  reactionCounts: Record<string, number>; myReaction: string | null; replyCount: number; editedAt: string | null; createdAt: string;
  replies?: CommentData[];
}
export interface Me { id: string; role: 'admin' | 'teacher' | 'student'; name: string; isMentorOf?: string; mutedUntil?: string }

export const REACTIONS = [
  { type: 'like', emoji: '👍', label: 'Like' },
  { type: 'love', emoji: '❤️', label: 'Love' },
  { type: 'haha', emoji: '😆', label: 'Haha' },
  { type: 'wow', emoji: '😮', label: 'Wow' },
  { type: 'sad', emoji: '😢', label: 'Sad' },
  { type: 'angry', emoji: '😡', label: 'Angry' },
] as const;
export const TAGS = [
  { value: 'general', label: 'General' },
  { value: 'problem', label: 'Problem / Need Help' },
  { value: 'study', label: 'Study' },
  { value: 'event', label: 'Event' },
] as const;

/** Where a name or photo leads: the Admin opens Student 360° for students, everyone else the public profile (PRD §5.7.1). */
export const profileHref = (a: Author, viewer?: Me): string | null =>
  !a.id ? null : viewer?.role === 'admin' && a.role === 'student' ? `/admin/students/${a.id}` : `/u/${a.id}`;

export const errorText = (e: unknown): string => {
  if (e instanceof ApiError && e.code === 'MUTED' && e.fields?.endsAt)
    return `You are muted until ${new Date(e.fields.endsAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}. You can still read.`;
  if (e instanceof ApiError) return Object.values(e.fields ?? {})[0] ? `${e.message} ${Object.values(e.fields ?? {})[0]}` : e.message;
  return 'Something went wrong. Try again.';
};

export const timeAgo = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
