import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Load checks run on demand against a dedicated environment (11 §5, skill cms-load-test); they are too slow for CI.
 * Each run stores a small summary JSON under test-results/load/, and these tests judge it against the targets.
 * Without a stored summary the test is SKIPPED, which means "not run", never "passed".
 *   exam.json  { "p95SaveMs": number, "errors": number, "virtualUsers": number }
 *   chat.json  { "p95DeliveryMs": number, "sockets": number, "errors": number }
 *   feed.json  { "loadMs": number }   (Lighthouse mobile, throttled 4G, logged-in feed first page)
 */
const dir = path.resolve(__dirname, '../test-results/load');
const read = (n: string) => (existsSync(path.join(dir, n)) ? JSON.parse(readFileSync(path.join(dir, n), 'utf8')) : null);
const has = (n: string) => existsSync(path.join(dir, n));

describe('load summaries', () => {
  it.skipIf(!has('exam.json'))('[OPS-05] 500 exam takers: p95 answer save < 300 ms, no errors', () => {
    const s = read('exam.json');
    expect(s.virtualUsers).toBeGreaterThanOrEqual(500);
    expect(s.p95SaveMs).toBeLessThan(300);
    expect(s.errors).toBe(0);
  });
  it.skipIf(!has('chat.json'))('[OPS-06] 200 chat sockets: p95 delivery < 1 s', () => {
    const s = read('chat.json');
    expect(s.sockets).toBeGreaterThanOrEqual(200);
    expect(s.p95DeliveryMs).toBeLessThan(1000);
    expect(s.errors).toBe(0);
  });
  it.skipIf(!has('feed.json'))('[OPS-07] feed first page < 2 s on throttled 4G', () => {
    expect(read('feed.json').loadMs).toBeLessThan(2000);
  });
});
