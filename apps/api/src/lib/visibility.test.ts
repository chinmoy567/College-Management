import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { asyncHandler } from './http';
import { errorHandler } from '../middleware/errorHandler';
import { findVisibleOrThrow } from './visibility';
import type { Actor } from './permissions';

const posts: Record<string, { id: string; ownerId: string }> = { p1: { id: 'p1', ownerId: 'u1' } };

function app() {
  const a = express();
  a.get('/posts/:id', asyncHandler(async (req, res) => {
    const actor: Actor = { id: String(req.header('x-user')), role: 'student' };
    const post = await findVisibleOrThrow(
      actor,
      async () => posts[String(req.params.id)] ?? null,
      (act, p) => p.ownerId === act.id,
    );
    res.json(post);
  }));
  a.use(errorHandler);
  return a;
}

describe('visibility', () => {
  it('[CONV-09] invisible object → 404', async () => {
    const ok = await request(app()).get('/posts/p1').set('x-user', 'u1');
    expect(ok.status).toBe(200);

    const hidden = await request(app()).get('/posts/p1').set('x-user', 'u2');
    const missing = await request(app()).get('/posts/nope').set('x-user', 'u2');
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    // Same body, so existence is not leaked.
    expect(hidden.body).toEqual(missing.body);
    expect(hidden.body.error.code).toBe('NOT_FOUND');
  });
});
