/**
 * Erreurs du module CFG (US-013). Codes stables, sans préfixe (CONTRIBUTING §11) :
 * - `PARAM_MISSING`, `PARAM_RETROACTIVE`, `FORBIDDEN` : 16 ADM-014 ;
 * - `CONFIG_INVALID`, `PARAM_UNKNOWN`, `PARAM_NOT_APPLICABLE`, `PARAM_IMMUTABLE`, `COUNTRY_UNKNOWN`,
 *   `TZDATA_MISMATCH` :
 *   PROPOSÉS par US-013, à reporter au catalogue 16 A.8.
 */
export type ConfigErrorCode =
  | 'CONFIG_INVALID'
  | 'PARAM_MISSING'
  | 'PARAM_RETROACTIVE'
  | 'PARAM_UNKNOWN'
  | 'PARAM_NOT_APPLICABLE'
  | 'COUNTRY_UNKNOWN'
  | 'TZDATA_MISMATCH'
  /** Levés par les gardes SQL (0002) ; listés ici pour la traduction des erreurs de la base. */
  | 'PARAM_IMMUTABLE'
  | 'FORBIDDEN';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly code: ConfigErrorCode;
  /** Détails lisibles (une ligne par défaut constaté), jamais de secret. */
  readonly details: readonly string[];

  constructor(code: ConfigErrorCode, message: string, details: readonly string[] = []) {
    super(
      details.length > 0 ? `${code}: ${message}\n- ${details.join('\n- ')}` : `${code}: ${message}`,
    );
    this.code = code;
    this.details = Object.freeze([...details]);
  }
}
