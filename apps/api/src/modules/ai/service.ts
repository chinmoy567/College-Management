import { Prisma } from '@prisma/client';
import { AI_BUSY_MESSAGE, type AiMessageBody } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { AppError } from '../../lib/http';
import { logger } from '../../lib/logger';
import type { Actor } from '../../lib/permissions';
import { dhakaDate } from '../../lib/time';
import { hasLiveAttempt } from '../exams/finalise';
import { groundingSnippets } from './grounding';
import { AI_MAX_TOKENS, AI_TIMEOUT_MS, aiSettings, providerFor } from './provider';
import { buildPrompt, estimateTokens, type HistoryTurn } from './prompt';

const NOT_FOUND = () => new AppError('NOT_FOUND', 404, 'Not found.');
const DEFAULT_TITLE = 'New chat';

// ───── conversations (own only; anything else is 404) ─────
async function own(actor: Actor, id: string) {
  const c = await prisma.aIConversation.findFirst({ where: { id, studentId: actor.id }, select: { id: true, title: true } });
  if (!c) throw NOT_FOUND();
  return c;
}

export async function listConversations(actor: Actor) {
  const rows = await prisma.aIConversation.findMany({ where: { studentId: actor.id }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, title: true, updatedAt: true } });
  return { items: rows };
}

export async function createConversation(actor: Actor, title?: string) {
  const c = await prisma.aIConversation.create({ data: { studentId: actor.id, title: title ?? DEFAULT_TITLE }, select: { id: true, title: true, updatedAt: true } });
  return c;
}

export async function deleteConversation(actor: Actor, id: string): Promise<void> {
  await own(actor, id);
  await prisma.aIConversation.delete({ where: { id } }); // messages cascade
}

export async function listMessages(actor: Actor, id: string) {
  await own(actor, id);
  const rows = await prisma.aIMessage.findMany({ where: { conversationId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500, select: { id: true, role: true, content: true, createdAt: true } });
  return { items: rows };
}

// ───── daily limit: one statement, exact under concurrency ─────
const dayOf = () => dhakaDate(now());

/** Takes one message from today's allowance; returns the new count, or null when the limit is reached. */
export async function takeDaily(studentId: string, limit: number): Promise<number | null> {
  if (limit < 1) return null;
  const rows = await prisma.$queryRaw<{ message_count: number }[]>(Prisma.sql`
    INSERT INTO ai_usage (student_id, date, message_count) VALUES (${studentId}, ${dayOf()}::date, 1)
    ON CONFLICT (student_id, date) DO UPDATE SET message_count = ai_usage.message_count + 1
      WHERE ai_usage.message_count < ${limit}
    RETURNING message_count`);
  return rows[0]?.message_count ?? null;
}

export async function refundDaily(studentId: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`UPDATE ai_usage SET message_count = GREATEST(message_count - 1, 0) WHERE student_id = ${studentId} AND date = ${dayOf()}::date`);
}

export async function usageMe(actor: Actor): Promise<{ usedToday: number; limit: number }> {
  const [row, s] = await Promise.all([prisma.aIUsage.findUnique({ where: { studentId_date: { studentId: actor.id, date: new Date(`${dayOf()}T00:00:00Z`) } } }), aiSettings()]);
  return { usedToday: row?.messageCount ?? 0, limit: s.dailyLimit };
}

/** Admin: counts per day and per section only. No conversation or message is read (09 section 2.8). */
export async function usageAdmin(q: { from?: string; to?: string }) {
  const to = q.to ?? dayOf();
  const from = q.from ?? dhakaDate(new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86_400_000));
  const [days, sections] = await Promise.all([
    prisma.$queryRaw<{ date: Date; count: number }[]>(Prisma.sql`
      SELECT date, SUM(message_count)::int AS count FROM ai_usage WHERE date BETWEEN ${from}::date AND ${to}::date GROUP BY date ORDER BY date`),
    prisma.$queryRaw<{ section_id: string; name: string; class_level: number; group_type: string; count: number }[]>(Prisma.sql`
      SELECT s.id AS section_id, s.name, s.class_level, g.type::text AS group_type, SUM(u.message_count)::int AS count
      FROM ai_usage u JOIN student_profiles p ON p.user_id = u.student_id JOIN sections s ON s.id = p.section_id JOIN groups g ON g.id = s.group_id
      WHERE u.date BETWEEN ${from}::date AND ${to}::date GROUP BY s.id, s.name, s.class_level, g.type ORDER BY count DESC`),
  ]);
  return {
    from, to,
    days: days.map((d) => ({ date: d.date.toISOString().slice(0, 10), count: d.count })),
    sections: sections.map((s) => ({ sectionId: s.section_id, label: `Class ${s.class_level} ${s.group_type} ${s.name}`, count: s.count })),
  };
}

// ───── the answer pipeline (09 section 2.3) ─────
const busy = () => new AppError('AI_BUSY', 503, AI_BUSY_MESSAGE);

/**
 * Steps 2-8 (rate limit 1 is a route middleware). Returns an async generator of answer text; errors before the first
 * chunk surface from the first `next()` as normal API errors, so the caller can still send JSON.
 */
export async function startAnswer(actor: Actor, conversationId: string, body: AiMessageBody): Promise<AsyncGenerator<string, void, void>> {
  const conv = await own(actor, conversationId);
  if (await hasLiveAttempt(actor.id, now()))
    throw new AppError('AI_DISABLED_DURING_EXAM', 423, 'The AI assistant is switched off while you are taking an exam.');
  const settings = await aiSettings();
  if ((await takeDaily(actor.id, settings.dailyLimit)) === null)
    throw new AppError('AI_DAILY_LIMIT', 429, "You have used today's AI messages. Try again tomorrow.");

  let userMsgId: string;
  let history: HistoryTurn[];
  try {
    const prior = await prisma.aIMessage.findMany({ where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 12, select: { role: true, content: true } });
    history = prior.reverse().filter((m): m is HistoryTurn => m.role === 'user' || m.role === 'assistant');
    const saved = await prisma.aIMessage.create({ data: { conversationId, role: 'user', content: body.content, tokens: estimateTokens(body.content) }, select: { id: true } });
    userMsgId = saved.id;
    await prisma.aIConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date(), ...(conv.title === DEFAULT_TITLE && !history.length ? { title: body.content.replace(/\s+/g, ' ').slice(0, 60) } : {}) },
    });
  } catch (e) {
    await refundDaily(actor.id);
    throw e;
  }

  const notes = await groundingSnippets(actor, body.content, body.courseId).catch(() => []);
  const messages = buildPrompt({ question: body.content, history, notes });
  return answerStream(actor, conversationId, userMsgId, messages, settings);
}

async function* answerStream(actor: Actor, conversationId: string, userMsgId: string, messages: ReturnType<typeof buildPrompt>, settings: Awaited<ReturnType<typeof aiSettings>>): AsyncGenerator<string, void, void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  let text = '';
  let finished = false;
  let failed = false;
  try {
    for await (const chunk of providerFor(settings.provider).stream(messages, { model: settings.model, maxTokens: AI_MAX_TOKENS, signal: ctrl.signal })) {
      text += chunk;
      yield chunk;
    }
    if (!text.trim()) throw new Error('empty answer');
    finished = true;
  } catch (e) {
    failed = true;
    // Never log the prompt or the answer, and never show the provider's own error text.
    logger.warn({ status: (e as { status?: number }).status, name: (e as Error).name }, 'AI provider failed');
    await refundDaily(actor.id);
    await prisma.aIMessage.deleteMany({ where: { id: userMsgId } });
    throw busy();
  } finally {
    clearTimeout(timer);
    ctrl.abort();
    // The reader went away part-way: keep what was already shown (the message stays counted).
    if (!finished && !failed && text.trim()) await save(conversationId, text).catch(() => undefined);
  }
  await save(conversationId, text);
}

const save = (conversationId: string, text: string) =>
  prisma.aIMessage.create({ data: { conversationId, role: 'assistant', content: text, tokens: estimateTokens(text) } });
