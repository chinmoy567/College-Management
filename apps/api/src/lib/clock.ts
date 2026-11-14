/** The only clock the exam code reads, so tests can freeze or move time (05 §3 "injectable clock"). */
let override: (() => Date) | null = null;
export const now = (): Date => (override ? override() : new Date());
/** Tests only: pass a function to fake the time, or `null` to restore the real clock. */
export const setClock = (fn: (() => Date) | null): void => {
  override = fn;
};
