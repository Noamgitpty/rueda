/**
 * Port `MapTiles` du module CAT (17 §5 « Cartes / géocodage », §10, corrigé VERIF_16-M11 ; SRC-008 ;
 * US-020, ADR-057).
 *
 * Fonds de carte seuls (marqueurs de prix aux positions approximatives) : aucun géocodage, aucune
 * autocomplétion (`GeoProvider` différé). Le fournisseur reçoit l'IP du visiteur : il sera inscrit
 * dans `subprocessor` (ADR-006). Coordonnées hors grille ⇒ `OUT_OF_RANGE` ; quota épuisé ⇒
 * `QUOTA_EXCEEDED`. Lecture pure : rejouable, pas de clé d'idempotence.
 *
 * Adaptateurs : FAKE `@rueda/fake-adapters/maps` ; fournisseur de tuiles à choisir.
 */
export type MapTilesOutcome<T, R extends string> =
  | { readonly status: 'OK'; readonly value: T; readonly replayed: boolean }
  | { readonly status: 'REFUSED'; readonly reason: R | 'IDEMPOTENCY_CONFLICT' | 'UNSUPPORTED' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface TileRequest {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface Tile {
  readonly contentType: 'image/png';
  readonly body: Buffer;
  readonly attribution: string;
  readonly cacheTtlSeconds: number;
}

export interface MapTiles {
  readonly maxZoom: number;
  tile(request: TileRequest): Promise<MapTilesOutcome<Tile, 'OUT_OF_RANGE' | 'QUOTA_EXCEEDED'>>;
}
