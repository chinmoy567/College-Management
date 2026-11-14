import type { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import type { NoticeAudience, NoticeCreateBody } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { loadAuthors, authorOf } from '../../lib/authorLine';
import { signMany, softDeleteObjects, storeUpload, type UploadedFile } from '../../lib/files';
import { AppError } from '../../lib/http';
import { notifyBulk } from '../../lib/notify';
import { decodeCursor, encodeCursor } from '../../lib/pagination';
import type { Actor } from '../../lib/permissions';
import { enqueue, jobsRunning } from '../../jobs';

const NOT_FOUND = () => new AppError('NOT_FOUND', 404, 'Not found.');
const BATCH = 1000;

/** Rich text allow-list (07 §3.2). Links open safely; nothing else survives. */
export const cleanHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'h3', 'h4', 'blockquote'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
  });
const plain = (html: string): string => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();

// ───── audience ─────
/** Who the author may address. Central = Admin only; class-wise = teachers, limited to their own offerings/sections. */
async function checkAudience(actor: Actor, scope: 'central' | 'class', a: NoticeAudience): Promise<void> {
  const bad = (m: string) => new AppError('VALIDATION_ERROR', 400, m, { audience: m });
  if (scope === 'central') {
    if (actor.role !== 'admin') throw new AppError('FORBIDDEN', 403, 'Only the Admin can publish central notices.');
    if (a.offeringIds || a.sectionIds) throw bad('Central notices use all, role, session or group.');
    if (!a.all && !a.roles && !a.sessionIds && !a.groupIds) throw bad('Choose who should get this notice.');
    if (a.all && (a.roles || a.sessionIds || a.groupIds)) throw bad('Choose everyone or filters, not both.');
    if (a.sessionIds && (await prisma.session.count({ where: { id: { in: a.sessionIds } } })) !== a.sessionIds.length) throw bad('Unknown session.');
    if (a.groupIds && (await prisma.group.count({ where: { id: { in: a.groupIds } } })) !== a.groupIds.length) throw bad('Unknown group.');
    return;
  }
  if (actor.role !== 'teacher') throw new AppError('FORBIDDEN', 403, 'Only teachers can publish class notices.');
  if (a.all || a.roles || a.sessionIds || a.groupIds) throw bad('Class notices use offerings or sections.');
  if (!a.offeringIds?.length && !a.sectionIds?.length) throw bad('Choose a course offering or a section.');
  const mine = await prisma.courseOffering.findMany({ where: { teacherId: actor.id, endedAt: null, section: { deletedAt: null } }, select: { id: true, sectionId: true } });
  const mentored = await prisma.section.findMany({ where: { mentorTeacherId: actor.id, deletedAt: null }, select: { id: true } });
  const okOfferings = new Set(mine.map((o) => o.id));
  const okSections = new Set([...mine.map((o) => o.sectionId), ...mentored.map((s) => s.id)]);
  if (a.offeringIds?.some((i) => !okOfferings.has(i))) throw new AppError('FORBIDDEN', 403, 'You can only address offerings you teach.');
  if (a.sectionIds?.some((i) => !okSections.has(i))) throw new AppError('FORBIDDEN', 403, 'You can only address sections you teach in or mentor.');
}

/** Resolves an audience to active user ids (07 §3.1). Central: AND between keys, OR within a list. Class: enrolled/active students. */
export async function resolveAudience(scope: 'central' | 'class', a: NoticeAudience): Promise<string[]> {
  const ids = new Set<string>();
  if (scope === 'class') {
    if (a.offeringIds?.length) {
      const e = await prisma.enrollment.findMany({
        where: { courseOfferingId: { in: a.offeringIds }, status: 'active', student: { user: { status: 'active' } } },
        select: { studentId: true },
      });
      e.forEach((x) => ids.add(x.studentId));
    }
    if (a.sectionIds?.length) {
      const s = await prisma.studentProfile.findMany({ where: { sectionId: { in: a.sectionIds }, user: { status: 'active' } }, select: { userId: true } });
      s.forEach((x) => ids.add(x.userId));
    }
    return [...ids];
  }
  const roles = a.all ? ['student', 'teacher'] : (a.roles ?? ['student', 'teacher']);
  const sectionFilter: Prisma.SectionWhereInput = {
    deletedAt: null,
    group: { ...(a.groupIds ? { id: { in: a.groupIds } } : {}), ...(a.sessionIds ? { sessionId: { in: a.sessionIds } } : {}) },
  };
  const filtered = !a.all && (!!a.sessionIds || !!a.groupIds);
  if (roles.includes('student')) {
    const s = await prisma.studentProfile.findMany({
      where: { user: { status: 'active' }, ...(filtered ? { section: sectionFilter } : {}) },
      select: { userId: true },
    });
    s.forEach((x) => ids.add(x.userId));
  }
  if (roles.includes('teacher')) {
    // A teacher belongs to a session/group through an active offering they teach or the section they mentor.
    const t = await prisma.teacherProfile.findMany({
      where: {
        user: { status: 'active' },
        ...(filtered ? { OR: [{ offeringTeachers: { some: { endedAt: null, section: sectionFilter } } }, { mentoredSection: { is: sectionFilter } }] } : {}),
      },
      select: { userId: true },
    });
    t.forEach((x) => ids.add(x.userId));
  }
  return [...ids];
}

// ───── create / publish ─────
export async function createNotice(actor: Actor, b: NoticeCreateBody, files: UploadedFile[]): Promise<{ id: string; published: boolean }> {
  const audience = b.audience as NoticeAudience;
  await checkAudience(actor, b.scope, audience);
  if (b.showOnLanding && b.scope !== 'central') throw new AppError('VALIDATION_ERROR', 400, 'Only central notices can show on the landing page.', { showOnLanding: 'Not allowed' });
  if (files.length > 5) throw new AppError('VALIDATION_ERROR', 400, 'At most 5 attachments.', { attachments: 'count' });
  const t = now();
  const publishAt = b.publishAt ?? t;
  if (b.expiresAt && b.expiresAt <= publishAt) throw new AppError('VALIDATION_ERROR', 400, 'The expiry must be after the publish time.', { expiresAt: 'Invalid' });
  const bodyHtml = cleanHtml(b.bodyHtml);
  if (!plain(bodyHtml)) throw new AppError('VALIDATION_ERROR', 400, 'Write the notice.', { bodyHtml: 'Required' });

  // Attachments go to the public bucket only for landing-page notices (PRD §8).
  const stored: string[] = [];
  try {
    for (const f of files) {
      const isPdf = f.buffer.subarray(0, 5).toString() === '%PDF-';
      stored.push(await storeUpload(actor.id, b.showOnLanding ? 'landing_notice' : 'notice_file', isPdf ? 'document' : 'image', f));
    }
  } catch (e) {
    await softDeleteObjects(stored);
    throw e;
  }
  const n = await prisma.notice.create({
    data: {
      authorId: actor.id, scope: b.scope, audience, title: b.title, bodyHtml, priority: b.priority,
      showOnLanding: !!b.showOnLanding, publishAt, expiresAt: b.expiresAt ?? null,
      attachments: { create: stored.map((fileId) => ({ fileId })) },
    },
    select: { id: true },
  });
  if (publishAt <= t) {
    if (jobsRunning()) await enqueue('notice.publish', { id: n.id });
    else await publishNotice(n.id);
    return { id: n.id, published: true };
  }
  if (jobsRunning()) await enqueue('notice.publish', { id: n.id }, { startAfter: publishAt });
  return { id: n.id, published: false };
}

/** Job body (07 §3.3). Idempotent: only the run that sets `publishedAt` does the work. Returns recipient count, or null if skipped. */
export async function publishNotice(noticeId: string): Promise<number | null> {
  const t = now();
  const claim = await prisma.notice.updateMany({ where: { id: noticeId, publishedAt: null, deletedAt: null, publishAt: { lte: t } }, data: { publishedAt: t } });
  if (claim.count === 0) return null;
  const n = await prisma.notice.findUniqueOrThrow({ where: { id: noticeId } });
  const audience = n.audience as NoticeAudience;
  const users = new Set(await resolveAudience(n.scope, audience));
  users.add(n.authorId); // the author sees their own notice
  const all = [...users];
  const notified = all.filter((u) => u !== n.authorId);
  const email =
    n.priority === 'normal'
      ? undefined
      : { subject: `${n.priority === 'urgent' ? 'Urgent notice' : 'Important notice'}: ${n.title}`, text: `${n.title}\n\n${plain(n.bodyHtml).slice(0, 500)}`, forced: n.priority === 'urgent' };
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    await prisma.noticeRecipient.createMany({ data: chunk.map((userId) => ({ noticeId, userId })), skipDuplicates: true });
    await notifyBulk(chunk.filter((u) => u !== n.authorId), 'notice_new', { type: 'notice', id: noticeId }, `New notice: ${n.title}`, prisma, { pushText: 'You have a new notice', email });
  }
  void notified;
  return all.length;
}

/** Safety net for the per-notice job: publishes anything that is due (run every minute). */
export async function publishDue(): Promise<number> {
  const due = await prisma.notice.findMany({ where: { publishedAt: null, deletedAt: null, publishAt: { lte: now() } }, select: { id: true }, take: 100 });
  let n = 0;
  for (const d of due) if ((await publishNotice(d.id)) !== null) n++;
  return n;
}

// ───── read side ─────
const visible = (): Prisma.NoticeWhereInput => ({ deletedAt: null, publishedAt: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }] });

async function serialize(rows: Prisma.NoticeGetPayload<{ include: { attachments: { include: { file: true } } } }>[], readIds: Set<string>) {
  const authors = await loadAuthors(rows.map((r) => r.authorId));
  const urls = await signMany(rows.flatMap((r) => r.attachments.map((a) => a.fileId)), { download: true });
  return rows.map((r) => ({
    id: r.id, scope: r.scope, title: r.title, bodyHtml: r.bodyHtml, priority: r.priority,
    publishedAt: r.publishedAt?.toISOString() ?? null, expiresAt: r.expiresAt?.toISOString() ?? null,
    showOnLanding: r.showOnLanding, author: authorOf(authors, r.authorId), read: readIds.has(r.id),
    attachments: r.attachments.map((a) => ({ id: a.fileId, name: a.file.originalName, mime: a.file.mime, url: urls.get(a.fileId) ?? null })),
  }));
}

export async function listNotices(me: Actor, q: { filter?: 'central' | 'class'; unread?: boolean; cursor?: string; limit: number }) {
  const cur = decodeCursor(q.cursor);
  const where: Prisma.NoticeWhereInput = {
    AND: [
      visible(),
      { recipients: { some: { userId: me.id } } },
      q.filter ? { scope: q.filter } : {},
      q.unread ? { reads: { none: { userId: me.id } } } : {},
      cur ? { OR: [{ publishedAt: { lt: new Date(cur.createdAt) } }, { publishedAt: new Date(cur.createdAt), id: { lt: cur.id } }] } : {},
    ],
  };
  const rows = await prisma.notice.findMany({ where, include: { attachments: { include: { file: true } } }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
  const page = rows.slice(0, q.limit);
  const reads = await prisma.noticeRead.findMany({ where: { userId: me.id, noticeId: { in: page.map((p) => p.id) } }, select: { noticeId: true } });
  const last = page[page.length - 1];
  return {
    items: await serialize(page, new Set(reads.map((r) => r.noticeId))),
    nextCursor: rows.length > q.limit && last?.publishedAt ? encodeCursor({ createdAt: last.publishedAt.toISOString(), id: last.id }) : null,
  };
}

export async function markNoticeRead(me: Actor, noticeId: string): Promise<void> {
  const r = await prisma.noticeRecipient.findUnique({ where: { noticeId_userId: { noticeId, userId: me.id } }, select: { noticeId: true } });
  if (!r) throw NOT_FOUND();
  await prisma.noticeRead.upsert({ where: { noticeId_userId: { noticeId, userId: me.id } }, create: { noticeId, userId: me.id }, update: {} });
}

export async function urgentUnread(me: Actor) {
  const rows = await prisma.notice.findMany({
    where: { AND: [visible(), { priority: 'urgent' }, { recipients: { some: { userId: me.id } } }, { reads: { none: { userId: me.id } } }] },
    include: { attachments: { include: { file: true } } }, orderBy: { publishedAt: 'desc' }, take: 5,
  });
  return { items: await serialize(rows, new Set()) };
}

export async function publicNotices() {
  const rows = await prisma.notice.findMany({
    where: { AND: [visible(), { showOnLanding: true, scope: 'central' }] },
    include: { attachments: { include: { file: true } } }, orderBy: { publishedAt: 'desc' }, take: 10,
  });
  const urls = await signMany(rows.flatMap((r) => r.attachments.map((a) => a.fileId)));
  return {
    items: rows.map((r) => ({
      id: r.id, title: r.title, bodyHtml: r.bodyHtml, priority: r.priority, publishedAt: r.publishedAt?.toISOString() ?? null,
      attachments: r.attachments.map((a) => ({ name: a.file.originalName, mime: a.file.mime, url: urls.get(a.fileId) ?? null })),
    })),
  };
}

export async function updateNotice(me: Actor, noticeId: string, patch: { title?: string; bodyHtml?: string; priority?: 'normal' | 'important' | 'urgent'; expiresAt?: Date | null }) {
  const n = await prisma.notice.findFirst({ where: { id: noticeId, deletedAt: null } });
  if (!n || (me.role !== 'admin' && n.authorId !== me.id)) throw NOT_FOUND();
  const bodyHtml = patch.bodyHtml === undefined ? undefined : cleanHtml(patch.bodyHtml);
  if (bodyHtml !== undefined && !plain(bodyHtml)) throw new AppError('VALIDATION_ERROR', 400, 'Write the notice.', { bodyHtml: 'Required' });
  // Editing after publish never re-notifies; the stored recipients stay as they were.
  await prisma.notice.update({ where: { id: noticeId }, data: { title: patch.title, bodyHtml, priority: patch.priority, expiresAt: patch.expiresAt } });
}

export async function deleteNotice(me: Actor, noticeId: string) {
  const n = await prisma.notice.findFirst({ where: { id: noticeId, deletedAt: null }, include: { attachments: true } });
  if (!n || (me.role !== 'admin' && n.authorId !== me.id)) throw NOT_FOUND();
  await prisma.notice.update({ where: { id: noticeId }, data: { deletedAt: now() } });
  await softDeleteObjects(n.attachments.map((a) => a.fileId));
}

/** What the composer can offer: sessions and groups for the Admin; own offerings and sections for a teacher. */
export async function audienceOptions(me: Actor) {
  if (me.role === 'admin') {
    const sessions = await prisma.session.findMany({ where: { status: 'active' }, orderBy: { name: 'desc' }, select: { id: true, name: true, groups: { select: { id: true, type: true } } } });
    return { sessions: sessions.map((s) => ({ id: s.id, name: s.name, groups: s.groups })), offerings: [], sections: [] };
  }
  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId: me.id, endedAt: null, section: { deletedAt: null, group: { session: { status: 'active' } } } },
    select: { id: true, course: { select: { name: true } }, section: { select: { id: true, name: true, classLevel: true, group: { select: { type: true } } } } },
  });
  const mentored = await prisma.section.findMany({ where: { mentorTeacherId: me.id, deletedAt: null, group: { session: { status: 'active' } } }, select: { id: true, name: true, classLevel: true, group: { select: { type: true } } } });
  const label = (s: { name: string; classLevel: number; group: { type: string } }) => `Class ${s.classLevel} ${s.group.type} ${s.name}`;
  const sections = new Map<string, string>();
  for (const o of offerings) sections.set(o.section.id, label(o.section));
  for (const m of mentored) sections.set(m.id, `${label(m)} (my section)`);
  return {
    sessions: [],
    offerings: offerings.map((o) => ({ id: o.id, label: `${o.course.name} - ${label(o.section)}` })),
    sections: [...sections].map(([id, label]) => ({ id, label })),
  };
}
