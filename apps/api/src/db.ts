import { PrismaClient } from '@prisma/client';
import { logger } from './lib/logger';

export const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'query' }],
});

prisma.$on('query', (e) => {
  if (e.duration > 200) logger.warn({ durationMs: e.duration }, 'slow query');
});
