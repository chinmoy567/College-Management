import { describe, expect, it } from 'vitest';
import { ALLOWED_RAW_DROPS, unexpectedStatements } from './db-drift-check';

describe('db drift check', () => {
  it('allows only the known raw-object drops', () => {
    const ok = `-- DropIndex\n${ALLOWED_RAW_DROPS[0]}\n\n-- AlterTable\n${ALLOWED_RAW_DROPS[4]}\n`;
    expect(unexpectedStatements(ok)).toEqual([]);
  });
  it('flags a dropped Prisma-managed index and any other change', () => {
    const bad = '-- DropIndex\nDROP INDEX "users_role_status_idx";\nALTER TABLE "users" ADD COLUMN "x" TEXT;';
    expect(unexpectedStatements(bad)).toHaveLength(2);
  });
});
