import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AI_BUSY_MESSAGE, aiConversationCreateBody, aiMessageBody, aiUsageQuery, id } from '@cms/shared';
import { asyncHandler, validate } from '../../lib/http';
import { MIN, consume } from '../../lib/rateLimit';
import { requireRole } from '../../middleware/session';
import { actorOf } from '../feed/common';
import { createConversation, deleteConversation, listConversations, listMessages, startAnswer, usageAdmin, usageMe } from './service';

const params = z.object({ id });
export const AI_RATE_PER_MIN = 6;
/** Step 1 of the pipeline: 6 messages per minute per user. */
const aiRate: RequestHandler = (req, _res, next) => {
  consume(`ai:${actorOf(req).id}`, AI_RATE_PER_MIN, MIN).then(() => next(), next);
};

// ───── students only: /api/ai ─────
export const aiRouter = Router();
aiRouter.use(requireRole('student'));
aiRouter.get('/conversations', asyncHandler(async (req, res) => void res.json(await listConversations(actorOf(req)))));
aiRouter.post('/conversations', validate({ body: aiConversationCreateBody }), asyncHandler(async (req, res) => {
  res.status(201).json(await createConversation(actorOf(req), (req.body as { title?: string }).title));
}));
aiRouter.delete('/conversations/:id', validate({ params }), asyncHandler(async (req, res) => {
  await deleteConversation(actorOf(req), req.params.id as string);
  res.json({ ok: true });
}));
aiRouter.get('/conversations/:id/messages', validate({ params }), asyncHandler(async (req, res) => void res.json(await listMessages(actorOf(req), req.params.id as string))));
aiRouter.get('/usage/me', asyncHandler(async (req, res) => void res.json(await usageMe(actorOf(req)))));

/** The answer streams as text/event-stream: `data: {"t": "..."}` per chunk, then `event: done` (or `event: error`). */
aiRouter.post('/conversations/:id/messages', aiRate, validate({ params, body: aiMessageBody }), asyncHandler(async (req, res) => {
  const gen = await startAnswer(actorOf(req), req.params.id as string, req.body);
  const first = await gen.next(); // a provider failure before any text is still a normal JSON error (503 AI_BUSY)
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(beat);
    void gen.return();
  });
  const send = (event: string | null, data: object) => res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
  try {
    if (!first.done) {
      send(null, { t: first.value });
      for await (const t of gen) send(null, { t });
    }
    send('done', {});
  } catch {
    send('error', { code: 'AI_BUSY', message: AI_BUSY_MESSAGE });
  } finally {
    clearInterval(beat);
    res.end();
  }
}));

// ───── Admin: counts only ─────
export const adminAiRouter = Router();
adminAiRouter.use(requireRole('admin'));
adminAiRouter.get('/usage', validate({ query: aiUsageQuery }), asyncHandler(async (req, res) => void res.json(await usageAdmin(req.query as { from?: string; to?: string }))));
