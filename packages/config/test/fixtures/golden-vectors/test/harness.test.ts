// Fixture « test » : un fichier de test peut importer le harnais des vecteurs dorés.
import { loadGoldenVectors } from '@rueda/money/golden-vectors';

export const used: unknown[] = [loadGoldenVectors, import('@rueda/money/golden-vectors')];
