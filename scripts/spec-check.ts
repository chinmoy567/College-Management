import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', 'playwright-report', 'test-results']);

export function extractIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\*\*([A-Z]+-\d{2})\*\*/g)].map((m) => m[1]!))];
}

export function extractTestedIds(source: string): Set<string> {
  return new Set([...source.matchAll(/\[([A-Z]+-\d{2})\]/g)].map((m) => m[1]!));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.test\.ts$/.test(name) || /\.spec\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const specArg = args.includes('--spec') ? args[args.indexOf('--spec') + 1] : undefined;

  const specDir = join(ROOT, 'docs', 'spec');
  let files = readdirSync(specDir).filter((f) => /^\d{2}-.*\.md$/.test(f)).sort();
  if (specArg) files = files.filter((f) => f.startsWith(specArg.padStart(2, '0')));

  // --strict with no --spec: only the finished specs in scripts/spec-check.config.json.
  const cfgPath = join(ROOT, 'scripts', 'spec-check.config.json');
  if (strict && !specArg && existsSync(cfgPath)) {
    const finished = (JSON.parse(readFileSync(cfgPath, 'utf8')) as { finished: string[] }).finished;
    files = files.filter((f) => finished.includes(f.slice(0, 2)));
  }

  const tested = new Set<string>();
  for (const f of walk(ROOT)) for (const id of extractTestedIds(readFileSync(f, 'utf8'))) tested.add(id);

  let missingTotal = 0;
  for (const f of files) {
    const ids = extractIds(readFileSync(join(specDir, f), 'utf8'));
    const missing = ids.filter((id) => !tested.has(id));
    missingTotal += missing.length;
    console.log(`\n${relative(ROOT, join(specDir, f))}: ${ids.length - missing.length}/${ids.length} covered`);
    for (const id of ids) console.log(`  ${tested.has(id) ? 'covered' : 'MISSING'}  ${id}`);
  }
  if (strict && missingTotal > 0) {
    console.error(`\n${missingTotal} acceptance ID(s) have no test.`);
    process.exit(1);
  }
}

if (process.argv[1] && /spec-check\.ts$/.test(process.argv[1])) main();
