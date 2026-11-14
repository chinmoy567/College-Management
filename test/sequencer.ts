import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * The db/ seed tests assume an empty database (exactly one Admin, default settings), but every other integration
 * file creates its own Admin. Running db/ first keeps that true whatever order the cache would choose.
 */
export default class DbFirstSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const isDb = (f: TestSpecification) => f.moduleId.replace(/\\/g, '/').includes('/src/db/');
    return [...sorted.filter(isDb), ...sorted.filter((f) => !isDb(f))];
  }
}
