import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const testDir = dirname(fileURLToPath(import.meta.url));
export const fixturesDir = join(testDir, 'fixtures');
export const repoRoot = resolve(testDir, '..', '..', '..');
