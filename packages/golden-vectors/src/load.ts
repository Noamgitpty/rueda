/**
 * Chargement de l'export `docs/specs/tools/golden_vectors.json` et accès par identifiant.
 * Le fichier est produit et contrôlé en CI par `docs/specs/tools/export_golden_vectors.py`
 * (registre des oracles) ; ce paquet ne le réécrit jamais.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GoldenVectorsError, parseGoldenVectors } from './parse.ts';
import type {
  GoldenCheck,
  GoldenLegVector,
  GoldenSettlementVector,
  GoldenVectorSet,
  LegVectorKind,
} from './types.ts';

/** Chemin de l'export dans le dépôt (le paquet est à `packages/golden-vectors/`). */
export const GOLDEN_VECTORS_PATH = fileURLToPath(
  new URL('../../../docs/specs/tools/golden_vectors.json', import.meta.url),
);

let cached: GoldenVectorSet | undefined;

/** Lit, valide et convertit l'export. Sans argument, le résultat est mis en cache. */
export function loadGoldenVectors(path: string = GOLDEN_VECTORS_PATH): GoldenVectorSet {
  if (path === GOLDEN_VECTORS_PATH && cached) return cached;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new GoldenVectorsError(
      'GOLDEN_VECTORS_INVALID',
      `lecture de ${path} impossible (${String(cause)})`,
    );
  }
  const set = parseGoldenVectors(data);
  if (path === GOLDEN_VECTORS_PATH) cached = set;
  return set;
}

export interface VectorFilter {
  /** Code de devise tel qu'écrit dans l'export. */
  readonly currency?: string;
  /** `true` : écarte les vecteurs non normatifs (option non décidée, montant PROPOSÉ). */
  readonly normativeOnly?: boolean;
}

export function settlementVectors(
  set: GoldenVectorSet,
  filter: VectorFilter = {},
): readonly GoldenSettlementVector[] {
  return set.settlement.filter(
    (v) =>
      (filter.currency === undefined || v.currency === filter.currency) &&
      (!filter.normativeOnly || v.normative),
  );
}

export function legVectors(
  set: GoldenVectorSet,
  filter: VectorFilter & { readonly kind?: LegVectorKind } = {},
): readonly GoldenLegVector[] {
  return set.legs.filter(
    (v) =>
      (filter.currency === undefined || v.currency === filter.currency) &&
      (filter.kind === undefined || v.kind === filter.kind) &&
      (!filter.normativeOnly || v.normative),
  );
}

function byId<T extends { readonly id: string }>(list: readonly T[], id: string): T {
  const found = list.find((v) => v.id === id);
  if (!found)
    throw new GoldenVectorsError('GOLDEN_VECTOR_NOT_FOUND', `vecteur « ${id} » absent de l'export`);
  return found;
}

export const settlementVector = (set: GoldenVectorSet, id: string): GoldenSettlementVector =>
  byId(set.settlement, id);

export const legVector = (set: GoldenVectorSet, id: string): GoldenLegVector => byId(set.legs, id);

/** Contrôles d'oracle d'un vecteur : « T54 » rend aussi « T54a » et « T54b ». */
export function checksFor(set: GoldenVectorSet, vectorId: string): readonly GoldenCheck[] {
  const re = new RegExp(`^${vectorId.replace(/[^A-Za-z0-9]/g, '')}[a-z]?$`);
  return set.checks.filter((c) => c.vectorId !== null && re.test(c.vectorId));
}
