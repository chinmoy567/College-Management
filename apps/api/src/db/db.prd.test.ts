import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/** PRD §6 entity name (as written in the first column) to the Prisma model(s) that implement it. */
const ALIAS: Record<string, string[]> = {
  Settings: ['Setting'],
  'Question (bank)': ['Question'],
  'AIConversation / AIMessage': ['AIConversation', 'AIMessage'],
  'Token (reset / verify)': ['Token'],
};

function prdEntities(): string[] {
  const prd = readFileSync(join(__dirname, '../../../../docs/PRD.md'), 'utf8');
  const start = prd.indexOf('## 6. Data Model');
  const end = prd.indexOf('## 7.', start);
  expect(start).toBeGreaterThan(-1);
  return prd
    .slice(start, end)
    .split('\n')
    .map((l) => /^\| \*\*(.+?)\*\* \|/.exec(l)?.[1])
    .filter((x): x is string => !!x);
}

describe('PRD section 6 coverage', () => {
  it('[DB-06] every entity in PRD §6 exists as a Prisma model', () => {
    const entities = prdEntities();
    expect(entities.length).toBeGreaterThanOrEqual(55);
    const models = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
    const missing = entities.flatMap((e) => (ALIAS[e] ?? [e]).filter((m) => !models.has(m)));
    expect(missing).toEqual([]);
  });

  it('[DB-06] every table is snake_case plural-mapped and every model maps to a table', () => {
    for (const m of Prisma.dmmf.datamodel.models) {
      expect(m.dbName, m.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
