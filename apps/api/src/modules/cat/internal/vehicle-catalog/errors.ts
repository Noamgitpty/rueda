/**
 * Erreurs du catalogue de référence des véhicules (US-113). Codes stables, sans préfixe
 * (CONTRIBUTING §11) :
 * - `CATALOG_SOURCE_MISSING`, `CATALOG_VARIANT_RETIRED` : 16 HST-050 ;
 * - `CATALOG_SOURCE_UNLICENSED` (source dont la licence n'est pas validée, OQ-CAT-01 ; 17 ADR-034
 *   « import refusé si la licence de la source est inconnue »), `CATALOG_DATA_INVALID` (donnée de
 *   graine mal formée) et `CATALOG_VARIANT_NOT_FOUND` : PROPOSÉS par US-113, à reporter au
 *   catalogue 16 A.8.
 */
export type CatalogErrorCode =
  | 'CATALOG_SOURCE_MISSING'
  | 'CATALOG_SOURCE_UNLICENSED'
  | 'CATALOG_DATA_INVALID'
  | 'CATALOG_VARIANT_NOT_FOUND'
  | 'CATALOG_VARIANT_RETIRED';

export class CatalogError extends Error {
  override readonly name = 'CatalogError';
  readonly code: CatalogErrorCode;
  /** Défauts constatés, une ligne chacun (chemin de la ligne de graine), jamais de secret. */
  readonly details: readonly string[];

  constructor(code: CatalogErrorCode, message: string, details: readonly string[] = []) {
    super(
      details.length > 0 ? `${code}: ${message}\n- ${details.join('\n- ')}` : `${code}: ${message}`,
    );
    this.code = code;
    this.details = Object.freeze([...details]);
  }
}
