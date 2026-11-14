import { prisma } from '../db';

const norm = (s: string): string => s.normalize('NFC').toLowerCase();
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One regex for the whole list. Whole-word match with Unicode-aware boundaries, so "class" does not hit "classic"
 * and Bangla words work (`\b` does not understand Bangla). Combining marks count as part of the word.
 */
export function compileBanned(words: string[]): RegExp | null {
  const ws = [...new Set(words.map(norm).filter(Boolean))];
  if (ws.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${ws.map(esc).join('|')})(?![\\p{L}\\p{N}\\p{M}])`, 'u');
}
export const matchBanned = (text: string, re: RegExp | null): boolean => !!re && re.test(norm(text));

let cache: { re: RegExp | null; enabled: boolean } | null = null;
/** Call after the list or the switch changes. */
export const invalidateBannedWords = (): void => {
  cache = null;
};
async function load() {
  if (cache) return cache;
  const [flag, words] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'banned_words_enabled' } }),
    prisma.bannedWord.findMany({ select: { word: true } }),
  ]);
  return (cache = { enabled: flag?.value === true, re: compileBanned(words.map((w) => w.word)) });
}
/** True when the filter is switched on and the text contains a banned word. */
export async function containsBanned(...texts: (string | null | undefined)[]): Promise<boolean> {
  const c = await load();
  return c.enabled && texts.some((t) => !!t && matchBanned(t, c.re));
}
export const normaliseWord = norm;
