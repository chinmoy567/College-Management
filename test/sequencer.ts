import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * The db/ seed tests assume an empty database (exactly one Admin, default settings), but every other integration
 * file creates its own Admin. Running db/ first keeps that true whatever order the cache would choose.
 */
export default class DbFirstSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const isDb = (f: TestSpecification) => f.moduleId.replace(/\\/g, '/').includes('/src/db/');
    // db.seed* first and in a fixed order: they need the empty database that the other db files fill
    const rank = (f: TestSpecification) => (f.moduleId.includes('db.seed.int') ? 0 : f.moduleId.includes('db.seed-routine') ? 1 : 2);
    return [...sorted.filter(isDb).sort((a, b) => rank(a) - rank(b)), ...sorted.filter((f) => !isDb(f))];
  }
}
