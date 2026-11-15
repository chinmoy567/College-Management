import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const BASE = process.env.LOAD_BASE_URL ?? 'http://localhost:3200';
export const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'cms_session';
export const dir = path.resolve(__dirname, '../test-results/load');

export interface Fixture {
  examId: string;
  students: { id: string; token: string; section: number }[];
  conversations: { id: string; userIds: string[]; tokens: string[] }[];
}
export const fixture = (): Fixture => JSON.parse(readFileSync(path.join(dir, 'fixture.json'), 'utf8')) as Fixture;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const pct = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

export const save = (name: string, data: object): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), JSON.stringify(data, null, 1));
};

export const api = (token: string, method: string, url: string, body?: unknown): Promise<Response> =>
  fetch(BASE + url, {
    method,
    headers: { Cookie: `${COOKIE}=${token}`, 'X-Requested-With': 'cms', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
