import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../middleware/errorHandler';
import { validate } from './http';

describe('validate', () => {
  it('[CONV-02] unknown keys stripped (role/status ignored)', async () => {
    const a = express();
    a.use(express.json());
    a.post('/x', validate({ body: z.object({ name: z.string() }) }), (req, res) => {
      res.json(req.body);
    });
    a.use(errorHandler);
    const r = await request(a).post('/x').send({ name: 'A', role: 'admin', status: 'active' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ name: 'A' });
  });
});
