import { PIN_DAYS_DEFAULT } from '@cms/shared';
import { prisma } from '../../db';
import { notify, notifyBulk } from '../../lib/notify';

export async function pinDays(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: 'pin_days' } });
  return typeof s?.value === 'number' && s.value > 0 ? Math.min(s.value, PIN_DAYS_DEFAULT) : PIN_DAYS_DEFAULT // PRD §5.7.2: at most 7 days;
}

/** Who gets a `pinned_post` notification: everyone active (Admin pin) or the active students of the section (mentor pin). */
export async function notifyPinAudience(post: { id: string; authorId: string; pinAudience: 'all' | 'section' | null; pinSectionId: string | null }): Promise<void> {
  if (!post.pinAudience) return;
  const where =
    post.pinAudience === 'all'
      ? { status: 'active' as const, id: { not: post.authorId } }
      : { status: 'active' as const, id: { not: post.authorId }, student: { is: { sectionId: post.pinSectionId ?? '-' } } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  await notifyBulk(users.map((u) => u.id), 'pinned_post', { type: 'post', id: post.id }, 'New pinned announcement.');
}


/** Tells the post author, and for a reply the parent comment's author, about a new published comment. */
export async function notifyComment(c: { id: string; postId: string; authorId: string; parentCommentId: string | null }): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: c.postId }, select: { authorId: true } });
  const parent = c.parentCommentId ? await prisma.comment.findUnique({ where: { id: c.parentCommentId }, select: { authorId: true } }) : null;
  const targets = new Map<string, 'comment' | 'reply'>();
  if (post && post.authorId !== c.authorId) targets.set(post.authorId, 'comment');
  if (parent && parent.authorId !== c.authorId) targets.set(parent.authorId, 'reply');
  for (const [uid, type] of targets)
    await notify([uid], type, { type: 'post', id: c.postId }, type === 'reply' ? 'Someone replied to your comment.' : 'Someone commented on your post.');
}

