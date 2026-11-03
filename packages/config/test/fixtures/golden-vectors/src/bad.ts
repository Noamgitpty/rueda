// Fixture « production » : chaque forme d'import du harnais des vecteurs dorés doit être refusée.
import { loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenTrip } from '@rueda/money/golden-vectors/types.ts';
export { replay } from '../../../../../money/src/golden-vectors/index.ts';

const viaImport = import('@rueda/money/golden-vectors');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const viaRequire = require('@rueda/money/golden-vectors');

export const used: unknown[] = [loadGoldenVectors, viaImport, viaRequire, {} as GoldenTrip];
