import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/http';
import { errorHandler } from './errorHandler';

function app() {
  const a = express();
  a.get('/400', asyncHandler(async () => z.object({ n: z.number() }).parse({ n: 'x' })));
  a.get('/404', asyncHandler(async () => { throw new AppError('NOT_FOUND', 404, 'Nope.'); }));
  a.get('/409', asyncHandler(async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }); }));
  a.get('/500', asyncHandler(async () => { throw new Error('secret internals'); }));
  a.use(errorHandler);
  return a;
}

describe('error handler', () => {
  it('[CONV-01] error shape for 400/404/409/500, no stack', async () => {
    const r400 = await request(app()).get('/400');
    expect(r400.status).toBe(400);
    expect(r400.body.error.code).toBe('VALIDATION_ERROR');
    expect(r400.body.error.fields.n).toBeTruthy();

    const r404 = await request(app()).get('/404');
    expect(r404.status).toBe(404);
    expect(r404.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Nope.' } });

    const r409 = await request(app()).get('/409');
    expect(r409.status).toBe(409);
    expect(r409.body.error.code).toBe('CONFLICT');

    const r500 = await request(app()).get('/500');
    expect(r500.status).toBe(500);
    expect(r500.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(r500.body)).not.toMatch(/secret internals|stack| at /);
  });
});
