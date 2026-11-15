import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pub = path.resolve(__dirname, '../../public');

type Handler = (e: Record<string, unknown>) => void;

function loadWorker() {
  const handlers: Record<string, Handler> = {};
  const cached: string[] = [];
  const self = {
    location: { origin: 'https://college.test' },
    addEventListener: (n: string, h: Handler) => { handlers[n] = h; },
    registration: { showNotification: () => undefined },
    clients: { claim: () => undefined, matchAll: async () => [], openWindow: () => undefined },
    skipWaiting: () => undefined,
  };
  const caches = {
    open: async () => ({ addAll: async (urls: string[]) => void cached.push(...urls) }),
    match: async () => undefined,
    keys: async () => [],
    delete: async () => true,
  };
  vm.runInNewContext(readFileSync(path.join(pub, 'sw.js'), 'utf8'), { self, caches, URL, fetch: async () => ({}) });
  const fetchEvent = (url: string, o: { method?: string; mode?: string } = {}) => {
    let responded = false;
    handlers.fetch!({ request: { url, method: o.method ?? 'GET', mode: o.mode ?? 'cors' }, respondWith: () => { responded = true; } });
    return responded;
  };
  return { handlers, cached, fetchEvent };
}

describe('PWA', () => {
  it('[FE-09] manifest is installable and the service worker never caches personal API data', async () => {
    const m = JSON.parse(readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'));
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const i of m.icons) expect(existsSync(path.join(pub, i.src)), i.src).toBe(true);

    const sw = loadWorker();
    expect(sw.handlers.push).toBeTypeOf('function'); // push handler kept (07 §6)
    expect(sw.handlers.fetch).toBeTypeOf('function');
    // Precache list holds static files only.
    let installed: Promise<unknown> = Promise.resolve();
    sw.handlers.install!({ waitUntil: (p: Promise<unknown>) => { installed = p; } });
    await installed;
    expect(sw.cached.length).toBeGreaterThan(0);
    expect(sw.cached.some((u) => u.startsWith('/api'))).toBe(false);
    // API, socket and cross-origin requests are left to the network; page navigations get the offline fallback.
    expect(sw.fetchEvent('https://college.test/api/users/me')).toBe(false);
    expect(sw.fetchEvent('https://college.test/api/feed?page=1')).toBe(false);
    expect(sw.fetchEvent('https://college.test/socket.io/?EIO=4')).toBe(false);
    expect(sw.fetchEvent('https://cdn.other/x.js')).toBe(false);
    expect(sw.fetchEvent('https://college.test/api/x', { method: 'POST' })).toBe(false);
    expect(sw.fetchEvent('https://college.test/student', { mode: 'navigate' })).toBe(true);
    expect(existsSync(path.join(pub, 'offline.html'))).toBe(true);
  });
});
