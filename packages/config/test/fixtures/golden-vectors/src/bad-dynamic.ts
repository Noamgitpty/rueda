// Fixture « production » : formes dynamiques vers le harnais, toutes refusées.
import { createRequire } from 'node:module';

const viaTemplate = import(`@rueda/money/golden-vectors`);
const target = '@rueda/money/golden-vectors';
const viaVariable = import(target);
const viaCreateRequire = createRequire(import.meta.url)('@rueda/money/golden-vectors');
const viaGlobal = (globalThis as { require?: (id: string) => unknown }).require?.(
  `../../../../../money/src/golden-vectors/index.ts`,
);

export const used: unknown[] = [viaTemplate, viaVariable, viaCreateRequire, viaGlobal];
