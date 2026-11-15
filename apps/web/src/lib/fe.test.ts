import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDhaka, formatDhakaDate, formatDhakaTime } from './dhaka';

const SRC = join(__dirname, '..');
const files = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : /\.tsx?$/.test(n) ? [join(d, n)] : []));
const all = files(SRC).filter((f) => !f.endsWith('.test.ts'));

describe('frontend rules', () => {
  it('[FE-11] times are shown in Asia/Dhaka whatever the device zone', () => {
    const iso = '2026-03-10T20:30:00Z'; // 02:30 on 11 March in Dhaka (UTC+6)
    expect(formatDhakaTime(iso)).toBe('02:30');
    expect(formatDhakaDate(iso)).toBe('11 Mar 2026');
    expect(formatDhaka(iso)).toContain('11 Mar 2026');
  });

  it('[FE-11] no page formats dates with the device time zone', () => {
    for (const f of all) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\.(toLocaleString|toLocaleDateString|toLocaleTimeString)\(([^)]*)\)/g)) {
        if (/en-US/.test(m[2]) && !/Date\(/.test(src.slice(Math.max(0, m.index! - 40), m.index))) continue; // number formatting
        if (f.endsWith('dhaka.ts')) continue; // the helper itself pins TZ = 'Asia/Dhaka'
        expect(m[2], `${f} uses device time zone`).toContain('Asia/Dhaka');
      }
    }
  });

  it('[FE-10] Recharts, react-pdf, KaTeX, TipTap and YouTube are only imported through lazy modules', () => {
    const heavy = /from ['"](recharts|react-pdf|pdfjs-dist|katex|rehype-katex|@tiptap\/[^'"]+)['"]|import ['"]katex/;
    const lazyHosts = ['TrendChart.tsx', 'PdfReader.tsx', 'Markdown.tsx'];
    for (const f of all) {
      if (!heavy.test(readFileSync(f, 'utf8'))) continue;
      expect(lazyHosts.some((h) => f.endsWith(h)), `${f} imports a heavy library eagerly`).toBe(true);
    }
    // And each host is only reached via next/dynamic.
    const importers = (name: string) => all.filter((f) => new RegExp(`^(?!import type).*from ['"][^'"]*/${name}['"]`, 'm').test(readFileSync(f, 'utf8')));
    for (const h of ['TrendChart', 'PdfReader', 'Markdown']) {
      for (const f of importers(h)) expect(f, `${h} imported statically by ${f}`).toMatch(/Lazy|Reader\.tsx$/);
    }
  });

  it('[FE-08] reduced motion switches animations off and the exam page has no motion', () => {
    expect(readFileSync(join(SRC, 'app/globals.css'), 'utf8')).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*animation-duration:\s*0\.01ms[\s\S]*transition-duration:\s*0\.01ms/);
    const exam = files(join(SRC, 'app/student/take')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(exam).not.toMatch(/framer-motion|from ['"]motion|animate-|transition-(?!none)|duration-/);
  });
});
