import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { prisma } from '../../db';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.type('text/plain').status(200).send('ok');
  }),
);
