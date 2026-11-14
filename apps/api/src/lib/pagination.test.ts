import { describe, expect, it } from 'vitest';
import { cursorQuery } from '@cms/shared';
import { clampLimit, decodeCursor, paginate } from './pagination';

describe('pagination', () => {
  it('[CONV-03] list endpoints paginate default 20 max 50', () => {
    expect(cursorQuery.parse({}).limit).toBe(20);
    expect(cursorQuery.parse({ limit: '50' }).limit).toBe(50);
    expect(() => cursorQuery.parse({ limit: '51' })).toThrow();
    expect(() => cursorQuery.parse({ limit: '0' })).toThrow();
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(999)).toBe(50);
    expect(clampLimit(-3)).toBe(1);
  });

  it('[CONV-03] returns next cursor only when more rows exist, and it round-trips', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `id${i}`, createdAt: new Date(1000 * i) }));
    const page = paginate(rows, 3);
    expect(page.items).toHaveLength(3);
    expect(decodeCursor(page.nextCursor!)).toEqual({ id: 'id2', createdAt: new Date(2000).toISOString() });
    expect(paginate(rows.slice(0, 3), 3).nextCursor).toBeNull();
    expect(() => decodeCursor('not-a-cursor!!')).toThrow();
  });
});
