import { PAGINATION } from '@cms/shared';
import { AppError } from './http';

export interface Cursor {
  createdAt: string;
  id: string;
}

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor;
    if (typeof c.createdAt !== 'string' || typeof c.id !== 'string') throw new Error('bad');
    return c;
  } catch {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid cursor.', { cursor: 'Invalid cursor' });
  }
}

export function clampLimit(limit: number | undefined): number {
  const n = limit === undefined || !Number.isFinite(limit) ? PAGINATION.defaultLimit : Math.trunc(limit);
  return Math.min(Math.max(n, 1), PAGINATION.maxLimit);
}

/** Pass rows fetched with `take: limit + 1`; returns the page and the next cursor. */
export function paginate<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null;
  return { items, nextCursor };
}
