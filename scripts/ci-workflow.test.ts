import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CI workflow', () => {
  it('[OPS-09] CI runs typecheck, lint, tests, spec-check and build on every push', () => {
    const y = readFileSync(path.resolve(__dirname, '../.github/workflows/ci.yml'), 'utf8');
    expect(y).toMatch(/on:\s*\[push, pull_request\]/);
    expect(y).toContain('postgres:'); // service container for the integration tests
    for (const step of ['npm run typecheck', 'npm run lint', 'npm test', 'npm run spec:check -- --strict', 'npm run build']) {
      expect(y, step).toContain(`- run: ${step}`);
    }
    // Order: checks before build.
    expect(y.indexOf('npm run typecheck')).toBeLessThan(y.indexOf('npm run build'));
    expect(y.indexOf('npm test')).toBeLessThan(y.indexOf('npm run spec:check'));
  });
});
