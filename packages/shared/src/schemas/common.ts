import { z } from 'zod';
import { PAGINATION } from '../constants';

export const id = z.string().regex(/^c[a-z0-9]{20,30}$/, 'Invalid id');
export const dhakaDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const cursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
});
export type CursorQuery = z.infer<typeof cursorQuery>;
