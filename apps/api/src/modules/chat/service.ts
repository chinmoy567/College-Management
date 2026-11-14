import { Prisma } from '@prisma/client';
import type { MessageBody } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { containsBanned } from '../../lib/bannedWords';
import { loadAuthors, authorOf } from '../../lib/authorLine';
import { signMany } from '../../lib/files';
import { AppError } from '../../lib/http';
import { notifyBulk } from '../../lib/notify';
import { consume, MIN } from '../../lib/rateLimit';
import { realtime } from '../../lib/realtime';
import { assertNotMuted } from '../../lib/mute';
import { applyRoomDiff } from '../../lib/chatMembership';
import type { Actor } from '../../lib/permissions';

const NOT_FOUND = () => new AppError('NOT_FOUND', 404, 'Not found.');
export const BLOCKED_WORD_MSG = 'This message contains a blocked word.';

// ───── blocks ─────
/** Users who blocked `senderId` (they must not see the sender's messages). */
export async function blockersOf(senderId: string): Promise<string[]> {
  return (await prisma.block.findMany({ where: { blockedId: senderId }, select: { blockerId: true } })).map((b) => b.blockerId);
}
export async function blockedBy(userId: string): Promise<string[]> {
  return (await prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } })).map((b) => b.blockedId);
}
export async function addBlock(me: Actor, userId: string): Promise<void> {
  if (userId === me.id) throw new AppError('VALIDATION_ERROR', 400, 'You cannot block yourself.', { userId: 'Not allowed' });
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!u || u.status === 'deleted') throw NOT_FOUND();
  await prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } }, create: { blockerId: me.id, blockedId: userId }, update: {} });
}
export async function removeBlock(me: Actor, userId: string): Promise<void> {
  await prisma.block.deleteMany({ where: { blockerId: me.id, blockedId: userId } });
}

// ───── conversations ─────
/** PRD §5.8 allows every pair of roles; the target must be someone else and active. */
export async function getOrCreateDirect(me: Actor, userId: string): Promise<{ id: string; created: boolean }> {
  if (userId === me.id) throw new AppError('VALIDATION_ERROR', 400, 'You cannot chat with yourself.', { userId: 'Not allowed' });
  const other = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!other || other.status !== 'active') throw NOT_FOUND();
  const blocks = await prisma.block.findFirst({
    where: { OR: [{ blockerId: me.id, blockedId: userId }, { blockerId: userId, blockedId: me.id }] },
    select: { blockerId: true },
  });
  if (blocks) throw new AppError('BLOCKED', 403, 'You cannot message this person.');
  const directKey = [me.id, userId].sort().join(':');
  const existing = await prisma.conversation.findUnique({ where: { directKey }, select: { id: true } });
  if (existing) {
    await prisma.conversationMember.updateMany({ where: { conversationId: existing.id, userId: { in: [me.id, userId] }, leftAt: { not: null } }, data: { leftAt: null } });
    applyRoomDiff(me.id, { joined: [existing.id], left: [] });
    applyRoomDiff(userId, { joined: [existing.id], left: [] });
    return { id: existing.id, created: false };
  }
  try {
    const c = await prisma.conversation.create({
      data: { type: 'direct', directKey, members: { create: [{ userId: me.id }, { userId }] } },
      select: { id: true },
    });
    applyRoomDiff(me.id, { joined: [c.id], left: [] });
    applyRoomDiff(userId, { joined: [c.id], left: [] });
    return { id: c.id, created: true };
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      const again = await prisma.conversation.findUnique({ where: { directKey }, select: { id: true } });
      if (again) return { id: again.id, created: false };
    }
    throw e;
  }
}

/** Membership row; throws 404 when not a member (so ids do not leak). Left members only for reading. */
export async function memberOf(conversationId: string, userId: string, opts: { allowLeft?: boolean } = {}) {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: { select: { id: true, type: true } } },
  });
  if (!m || (m.leftAt && !opts.allowLeft)) throw NOT_FOUND();
  return m;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  sender: { id: string | null; name: string; avatarUrl: string | null };
  text: string | null;
  deleted: boolean;
  attachment: { id: string; url: string; name: string | null; mime: string } | null;
  createdAt: string;
  /** Direct: 0/1; group/section: how many members have read up to this message. Only on the viewer's own messages. */
  seenBy?: number;
  clientId?: string;
}

type MsgRow = Prisma.MessageGetPayload<{ include: { attachment: true } }>;
export async function toViews(rows: MsgRow[], viewerId?: string, extra: { clientId?: string } = {}): Promise<MessageView[]> {
  const authors = await loadAuthors(rows.map((r) => r.senderId));
  const urls = await signMany(rows.filter((r) => !r.deletedAt).map((r) => r.attachmentId).filter((x): x is string => !!x));
  const seen = viewerId ? await seenCounts(rows.filter((r) => r.senderId === viewerId)) : new Map<string, number>();
  return rows.map((r) => {
    const a = authorOf(authors, r.senderId);
    const att = r.attachment && !r.deletedAt && urls.get(r.attachment.id);
    return {
      id: r.id, conversationId: r.conversationId, senderId: r.senderId,
      sender: { id: a.id, name: a.name, avatarUrl: a.avatarUrl },
      text: r.deletedAt ? null : r.text,
      deleted: !!r.deletedAt,
      attachment: att && r.attachment ? { id: r.attachment.id, url: att, name: r.attachment.originalName, mime: r.attachment.mime } : null,
      createdAt: r.createdAt.toISOString(),
      ...(viewerId && r.senderId === viewerId ? { seenBy: seen.get(r.id) ?? 0 } : {}),
      ...(extra.clientId ? { clientId: extra.clientId } : {}),
    };
  });
}

/** Seen compares `createdAt`, not ids (cuids are not ordered): a member has seen a message when the message they last read is at or after it. */
async function seenCounts(mine: { id: string; conversationId: string; senderId: string; createdAt: Date }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!mine.length) return out;
  const convIds = [...new Set(mine.map((m) => m.conversationId))];
  const members = await prisma.conversationMember.findMany({
    where: { conversationId: { in: convIds }, leftAt: null, lastReadMessage: { isNot: null } },
    select: { conversationId: true, userId: true, lastReadMessage: { select: { createdAt: true, senderId: true } } },
  });
  for (const m of mine) {
    out.set(m.id, members.filter((x) => x.conversationId === m.conversationId && x.userId !== m.senderId && x.lastReadMessage && x.lastReadMessage.createdAt >= m.createdAt).length);
  }
  return out;
}

// ───── list ─────
interface ConvRow {
  id: string;
  type: 'direct' | 'group' | 'section';
  ref_id: string | null;
  last_message_at: Date | null;
  unread: bigint;
  lm_id: string | null;
  lm_text: string | null;
  lm_sender: string | null;
  lm_created: Date | null;
  lm_deleted: Date | null;
  lm_has_att: boolean | null;
}
export async function listConversations(me: Actor, limit: number, cursor?: { t: string; id: string }) {
  const blocked = await blockedBy(me.id);
  const rows = await prisma.$queryRaw<ConvRow[]>(Prisma.sql`
    SELECT c.id, c.type::text AS type, c.ref_id, c.last_message_at,
      (SELECT count(*) FROM messages m
        LEFT JOIN messages lr ON lr.id = cm.last_read_message_id
        WHERE m.conversation_id = c.id AND m.sender_id <> ${me.id} AND m.deleted_at IS NULL
          AND m.created_at > COALESCE(lr.created_at, cm.joined_at)
          ${blocked.length ? Prisma.sql`AND m.sender_id NOT IN (${Prisma.join(blocked)})` : Prisma.empty}) AS unread,
      lm.id AS lm_id, lm.text AS lm_text, lm.sender_id AS lm_sender, lm.created_at AS lm_created, lm.deleted_at AS lm_deleted,
      (lm.attachment_id IS NOT NULL) AS lm_has_att
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    LEFT JOIN LATERAL (
      SELECT * FROM messages m2 WHERE m2.conversation_id = c.id
        ${blocked.length ? Prisma.sql`AND m2.sender_id NOT IN (${Prisma.join(blocked)})` : Prisma.empty}
      ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) lm ON true
    WHERE cm.user_id = ${me.id} AND cm.left_at IS NULL
      ${cursor ? Prisma.sql`AND (COALESCE(c.last_message_at, c.created_at), c.id) < (${new Date(cursor.t)}, ${cursor.id})` : Prisma.empty}
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
    LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const sections = await prisma.section.findMany({ where: { id: { in: page.filter((r) => r.type === 'section').map((r) => r.ref_id!) } }, select: { id: true, name: true, classLevel: true, group: { select: { type: true } } } });
  const groups = await prisma.group.findMany({ where: { id: { in: page.filter((r) => r.type === 'group').map((r) => r.ref_id!) } }, select: { id: true, type: true, session: { select: { name: true } } } });
  const directs = await prisma.conversationMember.findMany({
    where: { conversationId: { in: page.filter((r) => r.type === 'direct').map((r) => r.id) }, userId: { not: me.id } },
    select: { conversationId: true, userId: true },
  });
  const authors = await loadAuthors(directs.map((d) => d.userId));
  const otherOf = new Map(directs.map((d) => [d.conversationId, d.userId]));
  const items = page.map((r) => {
    const sec = sections.find((s) => s.id === r.ref_id);
    const grp = groups.find((g) => g.id === r.ref_id);
    const other = r.type === 'direct' && otherOf.has(r.id) ? authorOf(authors, otherOf.get(r.id)!) : null;
    return {
      id: r.id, type: r.type,
      title: other ? other.name : sec ? `Class ${sec.classLevel} ${sec.name} (${sec.group.type})` : grp ? `${grp.session.name} ${grp.type}` : 'Chat',
      other,
      unread: Number(r.unread),
      lastMessage: r.lm_id ? { id: r.lm_id, senderId: r.lm_sender, text: r.lm_deleted ? null : r.lm_text, deleted: !!r.lm_deleted, hasAttachment: !!r.lm_has_att, createdAt: r.lm_created?.toISOString() } : null,
    };
  });
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ t: (last.last_message_at ?? new Date(0)).toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}

// ───── history ─────
export async function history(me: Actor, conversationId: string, q: { before?: string; after?: string; limit: number }): Promise<{ items: MessageView[]; hasMore: boolean }> {
  const m = await memberOf(conversationId, me.id, { allowLeft: true });
  const blocked = await blockedBy(me.id);
  const pivotId = q.before ?? q.after;
  const pivot = pivotId ? await prisma.message.findFirst({ where: { id: pivotId, conversationId }, select: { createdAt: true, id: true } }) : null;
  if (pivotId && !pivot) throw new AppError('VALIDATION_ERROR', 400, 'Unknown message.', { cursor: 'Invalid' });
  const where: Prisma.MessageWhereInput = {
    conversationId,
    ...(blocked.length ? { senderId: { notIn: blocked } } : {}),
    ...(m.leftAt ? { createdAt: { lte: m.leftAt } } : {}),
    ...(pivot
      ? q.after
        ? { OR: [{ createdAt: { gt: pivot.createdAt } }, { createdAt: pivot.createdAt, id: { gt: pivot.id } }] }
        : { OR: [{ createdAt: { lt: pivot.createdAt } }, { createdAt: pivot.createdAt, id: { lt: pivot.id } }] }
      : {}),
  };
  const rows = await prisma.message.findMany({
    where, include: { attachment: true },
    orderBy: q.after ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  if (!q.after) page.reverse(); // always oldest → newest for the client
  return { items: await toViews(page, me.id), hasMore };
}

// ───── send ─────
export async function sendMessage(me: Actor, conversationId: string, body: MessageBody, opts: { rateLimit?: boolean } = {}): Promise<MessageView> {
  const m = await memberOf(conversationId, me.id);
  await assertNotMuted(me.id);
  if (opts.rateLimit !== false) await consume(`chat:${me.id}`, 30, MIN);
  const text = body.text?.trim() || null;
  if (!text && !body.attachmentId) throw new AppError('VALIDATION_ERROR', 400, 'Write a message or attach a file.', { text: 'Required' });
  if (m.conversation.type === 'direct') {
    const other = await prisma.conversationMember.findFirst({ where: { conversationId, userId: { not: me.id } }, select: { userId: true, user: { select: { status: true } } } });
    if (!other || other.user.status !== 'active') throw new AppError('FORBIDDEN', 403, 'You cannot message this person.');
    const blocked = await prisma.block.findFirst({ where: { OR: [{ blockerId: me.id, blockedId: other.userId }, { blockerId: other.userId, blockedId: me.id }] } });
    if (blocked) throw new AppError('BLOCKED', 403, 'You cannot message this person.');
  }
  if (text && (await containsBanned(text))) throw new AppError('BLOCKED_WORD', 422, BLOCKED_WORD_MSG);
  if (body.attachmentId) {
    const f = await prisma.storageObject.findFirst({ where: { id: body.attachmentId, uploadedBy: me.id, deletedAt: null, key: { startsWith: 'chat_file/' } } });
    if (!f) throw new AppError('VALIDATION_ERROR', 400, 'Attachment not found.', { attachmentId: 'Invalid' });
    if (await prisma.message.findFirst({ where: { attachmentId: f.id }, select: { id: true } })) throw new AppError('VALIDATION_ERROR', 400, 'Attachment already used.', { attachmentId: 'Invalid' });
  }
  const t = now();
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.message.create({ data: { conversationId, senderId: me.id, text, attachmentId: body.attachmentId, createdAt: t }, include: { attachment: true } });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: t } });
    // The sender has read their own message.
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: me.id } }, data: { lastReadMessageId: r.id } });
    return r;
  });
  const [view] = await toViews([row], me.id, { clientId: body.clientId });
  const blockers = await blockersOf(me.id);
  // Persisted first; the emit comes after. Blockers do not receive the blocked user's messages.
  realtime().toConversation(conversationId, 'msg:new', { ...view!, seenBy: undefined }, blockers);
  void notifyOffline(conversationId, me.id, blockers).catch(() => {});
  return view!;
}

/** `new_message` for members who are not connected: at most one per conversation per 5 minutes (07 §2.2). */
async function notifyOffline(conversationId: string, senderId: string, blockers: string[]): Promise<void> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId, leftAt: null, userId: { notIn: [senderId, ...blockers] }, user: { status: 'active' } },
    select: { userId: true },
  });
  const offline = members.map((x) => x.userId).filter((id) => !realtime().isOnline(id));
  if (!offline.length) return;
  const since = new Date(Date.now() - 5 * MIN);
  const recent = await prisma.notification.findMany({
    where: { userId: { in: offline }, type: 'new_message', refType: 'conversation', refId: conversationId, createdAt: { gte: since } },
    select: { userId: true },
  });
  const skip = new Set(recent.map((r) => r.userId));
  const targets = offline.filter((id) => !skip.has(id));
  if (!targets.length) return;
  const a = authorOf(await loadAuthors([senderId]), senderId);
  await notifyBulk(targets, 'new_message', { type: 'conversation', id: conversationId }, `New message from ${a.name}`, prisma);
}

export async function deleteMessage(me: Actor, messageId: string): Promise<void> {
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg || msg.senderId !== me.id) throw NOT_FOUND();
  if (msg.deletedAt) return;
  await markDeleted(messageId);
}
/** Shared by the sender's delete and the Admin's removal of a reported message. */
export async function markDeleted(messageId: string): Promise<void> {
  const msg = await prisma.message.update({ where: { id: messageId }, data: { deletedAt: now() } });
  realtime().toConversation(msg.conversationId, 'msg:deleted', { id: msg.id, conversationId: msg.conversationId });
}

// ───── read ─────
/** Moves lastReadMessageId forward only (by createdAt). Returns the new read pointer or null if it would go back. */
export async function markRead(me: Actor, conversationId: string, messageId: string): Promise<{ messageId: string; createdAt: string } | null> {
  const m = await memberOf(conversationId, me.id);
  const target = await prisma.message.findFirst({ where: { id: messageId, conversationId }, select: { id: true, createdAt: true } });
  if (!target) throw NOT_FOUND();
  const cur = m.lastReadMessageId ? await prisma.message.findUnique({ where: { id: m.lastReadMessageId }, select: { createdAt: true } }) : null;
  if (cur && cur.createdAt >= target.createdAt) return null;
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: me.id } }, data: { lastReadMessageId: target.id } });
  const payload = { conversationId, userId: me.id, messageId: target.id, createdAt: target.createdAt.toISOString() };
  realtime().toConversation(conversationId, 'msg:read', payload);
  return { messageId: target.id, createdAt: payload.createdAt };
}

// ───── Admin review of a reported message (07 §2.4) ─────
export async function reportedContext(messageId: string): Promise<{ target: MessageView; before: MessageView[]; after: MessageView[] }> {
  const open = await prisma.report.findFirst({ where: { targetType: 'message', targetId: messageId, status: 'open' }, select: { id: true } });
  const msg = await prisma.message.findUnique({ where: { id: messageId }, include: { attachment: true } });
  if (!open || !msg) throw NOT_FOUND();
  const [before, after] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: msg.conversationId, OR: [{ createdAt: { lt: msg.createdAt } }, { createdAt: msg.createdAt, id: { lt: msg.id } }] },
      include: { attachment: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10,
    }),
    prisma.message.findMany({
      where: { conversationId: msg.conversationId, OR: [{ createdAt: { gt: msg.createdAt } }, { createdAt: msg.createdAt, id: { gt: msg.id } }] },
      include: { attachment: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 10,
    }),
  ]);
  const [target] = await toViews([msg]);
  // A deleted message stays visible to the Admin: they are reviewing what was said.
  const reveal = (v: MessageView, r: MsgRow) => (v.deleted ? { ...v, text: r.text } : v);
  return {
    target: reveal(target!, msg),
    before: (await toViews(before.reverse())).map((v, i) => reveal(v, before[i]!)),
    after: (await toViews(after)).map((v, i) => reveal(v, after[i]!)),
  };
}
