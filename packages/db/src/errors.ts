/**
 * Traduction des erreurs PostgreSQL en codes métier (US-006 ; 17 §2.5 étape 2d, §4.4 point 3,
 * §11 L0-08 ; 16 A.8 « Erreurs »).
 *
 * Règle (17 §2.5, M9 ; 16 A.8) : jamais de `DETAIL`, de message, de nom de table ni de valeur
 * PostgreSQL vers le client. Le résultat ne contient QUE le code métier et l'indication de rejeu.
 * La correspondance est faite sur le couple (SQLSTATE, nom de contrainte) : une contrainte
 * inconnue donne `INTERNAL_ERROR` (fail-closed : on ne devine pas).
 *
 * Origine des codes :
 * - `VEHICLE_UNAVAILABLE` : 17 §2.5 étape 2d, 16 A.8 (409) ;
 * - `GUEST_OVERLAP` : 17 §2.5 étape 4.4, 08 BR-BOOK-11 ;
 * - `DUPLICATE_PAYMENT` : 17 §2.5 étape 4.1 (second paiement sur un hold déjà converti) ;
 * - `INVALID_TRANSITION` : 17 §3.4, 16 A.8 (409) ;
 * - `INVARIANT_VIOLATION` : 17 §2.5 (motif d'alerte P1 de la conversion) ;
 * - `HOLD_ALREADY_LIVE`, `WEBHOOK_DUPLICATE`, `DISPOSITION_EXISTS`, `INTERNAL_ERROR`, `RETRY` :
 *   PROPOSÉS par US-006 (à reporter dans 16 A.8 par l'orchestrateur) ;
 * - `IMMUTABLE_RECORD`, `SUBJECT_ERASED`, `LEGAL_HOLD_ACTIVE` : PROPOSÉS par US-009 (registres en
 *   ajout seul, crypto-shredding ; migrations 0016 à 0020, ADR-051) ;
 * - `SETTLEMENT_EXISTS` : 08 (règle de qualification 5, EC-54, 409) ; `LEG_AMOUNT_NEGATIVE` : 08 E7
 *   règle 5 (nom PROPOSÉ) ; `SETTLEMENT_UNBALANCED` : PROPOSÉ par US-017 ; `SETTLEMENT_STALE` :
 *   PROPOSÉ par US-018 (trip modifié entre le calcul et l'enregistrement, 08 E4 ; migration 0027,
 *   ADR-057).
 */

/** Codes métier produits par la traduction. */
export const DB_BUSINESS_CODES = [
  'VEHICLE_UNAVAILABLE',
  'GUEST_OVERLAP',
  'HOLD_ALREADY_LIVE',
  'WEBHOOK_DUPLICATE',
  'DUPLICATE_PAYMENT',
  'DISPOSITION_EXISTS',
  'INVALID_TRANSITION',
  'INVARIANT_VIOLATION',
  'RETRY',
  'INTERNAL_ERROR',
  'IMMUTABLE_RECORD',
  'SUBJECT_ERASED',
  'LEGAL_HOLD_ACTIVE',
  'SETTLEMENT_EXISTS',
  'SETTLEMENT_STALE',
  'SETTLEMENT_UNBALANCED',
  'LEG_AMOUNT_NEGATIVE',
] as const;

export type DbBusinessCode = (typeof DB_BUSINESS_CODES)[number];

/** Résultat de la traduction : aucun détail technique. */
export interface DbBusinessError {
  readonly code: DbBusinessCode;
  /** Vrai pour `40P01` / `40001` : la transaction entière est à rejouer (17 §2.5, M2). */
  readonly retryable: boolean;
}

/** SQLSTATE utilisés (classe 23 : contraintes d'intégrité ; classe 40 : rejeu). */
export const SQLSTATE = {
  integrityConstraintViolation: '23000',
  uniqueViolation: '23505',
  exclusionViolation: '23P01',
  checkViolation: '23514',
  deadlockDetected: '40P01',
  serializationFailure: '40001',
} as const;

/**
 * Contraintes connues : `nom de contrainte → [SQLSTATE attendu, code métier]`. Les noms sont ceux
 * des migrations `packages/db/migrations/0004` à `0006`, `0016` à `0020` et `0027`.
 */
export const CONSTRAINT_CODES: Readonly<Record<string, readonly [string, DbBusinessCode]>> = {
  // 23P01 : exclusions GiST
  vehicle_occupancy_no_overlap: [SQLSTATE.exclusionViolation, 'VEHICLE_UNAVAILABLE'],
  guest_no_overlap: [SQLSTATE.exclusionViolation, 'GUEST_OVERLAP'],
  // 23505 : index uniques (L0-08)
  one_live_hold_per_guest_vehicle: [SQLSTATE.uniqueViolation, 'HOLD_ALREADY_LIVE'],
  webhook_inbox_dedup: [SQLSTATE.uniqueViolation, 'WEBHOOK_DUPLICATE'],
  one_conversion_per_hold: [SQLSTATE.uniqueViolation, 'DUPLICATE_PAYMENT'],
  payment_disposition_pkey: [SQLSTATE.uniqueViolation, 'DISPOSITION_EXISTS'],
  hold_compensation_operation_unique: [SQLSTATE.uniqueViolation, 'DISPOSITION_EXISTS'],
  one_active_occupancy_per_trip: [SQLSTATE.uniqueViolation, 'INVARIANT_VIOLATION'],
  // 23000 : triggers d'intégrité (0006)
  hold_terminal_status: [SQLSTATE.integrityConstraintViolation, 'INVALID_TRANSITION'],
  trip_has_active_occupancy: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  occupancy_trip_guard: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  occupancy_trip_ref_valid: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  hold_conversion_matches_disposition: [
    SQLSTATE.integrityConstraintViolation,
    'INVARIANT_VIOLATION',
  ],
  disposition_rent_payment_only: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  // 23000 : registres d'audit en ajout seul et clés par sujet (0016 à 0020, US-009)
  audit_log_append_only: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  data_access_log_append_only: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  audit_chain_head_guard: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  subject_key_immutable: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  file_asset_immutable: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  audit_log_key_destroyed: [SQLSTATE.integrityConstraintViolation, 'SUBJECT_ERASED'],
  subject_key_not_live: [SQLSTATE.integrityConstraintViolation, 'SUBJECT_ERASED'],
  subject_key_legal_hold: [SQLSTATE.integrityConstraintViolation, 'LEGAL_HOLD_ACTIVE'],
  // règlements versionnés et jambes (0027, US-018)
  settlement_version_taken: [SQLSTATE.integrityConstraintViolation, 'SETTLEMENT_EXISTS'],
  settlement_version_unique: [SQLSTATE.uniqueViolation, 'SETTLEMENT_EXISTS'],
  settlement_supersedes_unique: [SQLSTATE.uniqueViolation, 'SETTLEMENT_EXISTS'],
  settlement_trip_version: [SQLSTATE.integrityConstraintViolation, 'SETTLEMENT_STALE'],
  settlement_unbalanced: [SQLSTATE.integrityConstraintViolation, 'SETTLEMENT_UNBALANCED'],
  settlement_balance: [SQLSTATE.checkViolation, 'SETTLEMENT_UNBALANCED'],
  settlement_earnings: [SQLSTATE.checkViolation, 'SETTLEMENT_UNBALANCED'],
  settlement_platform_net: [SQLSTATE.checkViolation, 'SETTLEMENT_UNBALANCED'],
  settlement_line_split: [SQLSTATE.checkViolation, 'SETTLEMENT_UNBALANCED'],
  settlement_tax_line_split: [SQLSTATE.checkViolation, 'SETTLEMENT_UNBALANCED'],
  settlement_leg_variation: [SQLSTATE.checkViolation, 'SETTLEMENT_UNBALANCED'],
  settlement_leg_kept_nonneg: [SQLSTATE.checkViolation, 'LEG_AMOUNT_NEGATIVE'],
  settlement_leg_advance_platform: [SQLSTATE.checkViolation, 'LEG_AMOUNT_NEGATIVE'],
  trip_leg_balance_nonneg: [SQLSTATE.checkViolation, 'LEG_AMOUNT_NEGATIVE'],
  settlement_immutable: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  trip_leg_balance_no_delete: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  trip_leg_balance_monotonic: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_trip_unknown: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_trip_mismatch: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_supersession_invalid: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_basis_mismatch: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_negative_leg_flag: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_capture_missing: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_segment_unsupported: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_segment_beta: [SQLSTATE.checkViolation, 'INVARIANT_VIOLATION'],
  settlement_inputs_hash_match: [SQLSTATE.checkViolation, 'INVARIANT_VIOLATION'],
  settlement_inputs_engine: [SQLSTATE.checkViolation, 'INVARIANT_VIOLATION'],
};

const own = (value: object, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;

const result = (code: DbBusinessCode, retryable = false): DbBusinessError =>
  Object.freeze({ code, retryable });

/**
 * Traduit une erreur levée par `pg` en code métier, sans aucun détail technique.
 * Seuls `code` (SQLSTATE) et `constraint` de l'erreur sont lus.
 */
export function translateDbError(error: unknown): DbBusinessError {
  if (typeof error !== 'object' || error === null) return result('INTERNAL_ERROR');
  const sqlstate = own(error, 'code');
  const constraint = own(error, 'constraint');
  if (sqlstate === SQLSTATE.deadlockDetected || sqlstate === SQLSTATE.serializationFailure) {
    return result('RETRY', true);
  }
  if (typeof sqlstate !== 'string' || typeof constraint !== 'string') {
    return result('INTERNAL_ERROR');
  }
  const known = own(CONSTRAINT_CODES, constraint) as readonly [string, DbBusinessCode] | undefined;
  if (known === undefined || known[0] !== sqlstate) return result('INTERNAL_ERROR');
  return result(known[1]);
}
