import { AppError } from './http';
import type { Actor } from './permissions';

/**
 * Loads an object and returns it only if the actor may see it.
 * Missing and invisible objects both give the same 404 so existence is never leaked (CONV-09).
 */
export async function findVisibleOrThrow<T>(
  actor: Actor,
  load: () => Promise<T | null | undefined>,
  canSee: (actor: Actor, obj: T) => boolean | Promise<boolean>,
): Promise<T> {
  const obj = await load();
  if (obj === null || obj === undefined || !(await canSee(actor, obj))) {
    throw new AppError('NOT_FOUND', 404, 'Not found.');
  }
  return obj;
}
