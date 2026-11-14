import { api } from '@/lib/api';

/**
 * One shared IntersectionObserver for every pinned card (06 §3.4). A card counts as seen after it has been
 * at least 50% visible for 1 second without a break; ids are sent in batches every 2 s and when the tab is hidden.
 * Cards are never removed here: the post leaves the top on the next load.
 */
const SEEN_AFTER_MS = 1000;
const FLUSH_MS = 2000;

let observer: IntersectionObserver | null = null;
const timers = new Map<Element, ReturnType<typeof setTimeout>>();
const ids = new WeakMap<Element, string>();
const pending = new Set<string>();
const sent = new Set<string>();

function flush(): void {
  if (pending.size === 0) return;
  const postIds = [...pending];
  pending.clear();
  api('/feed/seen', { method: 'POST', json: { postIds } }).catch(() => postIds.forEach((i) => sent.delete(i)));
}

function start(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const visible = e.isIntersecting && e.intersectionRatio >= 0.5;
        const running = timers.get(e.target);
        if (visible && !running) {
          timers.set(
            e.target,
            setTimeout(() => {
              timers.delete(e.target);
              const id = ids.get(e.target);
              if (id && document.visibilityState === 'visible' && !sent.has(id)) {
                sent.add(id);
                pending.add(id);
              }
            }, SEEN_AFTER_MS),
          );
        } else if (!visible && running) {
          clearTimeout(running);
          timers.delete(e.target);
        }
      }
    },
    { threshold: [0, 0.5, 1] },
  );
  setInterval(flush, FLUSH_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  return observer;
}

/** Starts watching a pinned card; returns the function that stops. */
export function watchPinned(el: Element, postId: string): () => void {
  const o = start();
  ids.set(el, postId);
  o.observe(el);
  return () => {
    o.unobserve(el);
    const t = timers.get(el);
    if (t) clearTimeout(t);
    timers.delete(el);
    if (pending.size && timers.size === 0) flush();
  };
}
