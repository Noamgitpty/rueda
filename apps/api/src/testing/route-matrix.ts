/**
 * Matrice d'autorisations des routes (apps/api/security/route-matrix.json ; US-043, ADR-077) —
 * TESTS SEULEMENT : lue par route-matrix.test.ts (test:unit) et route-matrix.int.test.ts (test:int).
 */
import { readFileSync } from 'node:fs';

export interface RouteEntry {
  readonly acces: 'public' | 'session' | 'staff';
  readonly permission?: string;
  readonly roles?: readonly string[];
  readonly portee?: 'pays' | 'tous_les_pays' | 'sans_pays';
  readonly idor?: string;
}

export interface RouteMatrix {
  readonly acteurs: readonly string[];
  readonly routes: Readonly<Record<string, RouteEntry>>;
}

export const ROUTE_MATRIX = JSON.parse(
  readFileSync(new URL('../../security/route-matrix.json', import.meta.url), 'utf8'),
) as RouteMatrix;
