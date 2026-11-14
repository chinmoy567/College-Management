import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

const store = new AsyncLocalStorage<(() => void)[]>();

/** Runs `fn` after the surrounding `transaction()` commits; immediately when there is none. Dropped on rollback. */
export function defer(fn: () => void): void {
  const q = store.getStore();
  if (q) q.push(fn);
  else fn();
}

/** `prisma.$transaction` plus an after-commit queue (socket emits, room joins, socket disconnects). */
export async function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { timeout?: number; maxWait?: number },
): Promise<T> {
  const queue: (() => void)[] = [];
  const result = await store.run(queue, () => prisma.$transaction(fn, opts));
  for (const f of queue) {
    try {
      f();
    } catch {
      /* a failed socket emit must never undo a committed change */
    }
  }
  return result;
}
