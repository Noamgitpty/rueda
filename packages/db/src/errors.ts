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
 *   ADR-057) ;
 * - `IDEMPOTENCY_CONFLICT` : 16 fiche PAY-019 (même clé, contenu ou jambes différents) ;
 *   `LEG_SUM_MISMATCH`, `LEG_AMOUNT_NEGATIVE` : 17 §2.8, §4.3 point 5.8 ; `FAKE_FORBIDDEN_IN_PRODUCTION`,
 *   `PSP_ACCOUNT_INACTIVE`, `PAYMENT_SUBJECT_MISMATCH` : PROPOSÉS par US-019 (migration 0028, ADR-059) ;
 * - `FORBIDDEN` : 17 §2.5 (US-060, « sans révéler l'état »), 16 A.8 ; `PARAM_MISSING` : 17 §7.1 ;
 *   `INVALID_PERIOD` : PROPOSÉ par US-022 (période d'occupation mal formée ; migration 0032,
 *   ADR-060) ;
 * - `HOLD_LIMIT_REACHED`, `SELF_BOOKING_FORBIDDEN`, `BOOKING_UNDER_REVIEW` : 16 fiche BKG-014 ;
 *   `HOST_NOT_ACTIVATED` : 16 fiche BKG-012 ; `ACCOUNT_RESTRICTED` : 19 US-109, 16 ADM-005 (restriction
 *   active du voyageur, migration 0064, ADR-097) ; `HOLD_RATE_LIMITED` : 17 §2.5 (M5, 429) — commandes
 *   de hold d'US-023 (migration 0037, ADR-063) ;
 * - `HOST_PAYOUT_RAIL_UNAVAILABLE` : 08 E7, 17 §2.8 « Règle d'activation » (nom PROPOSÉ) ;
 *   `LEG_ALREADY_RELEASED` : 17 §2.8 « Erreurs normalisées », §4.3 point 8 — sous-marchands et
 *   écrivain des soldes par jambe d'US-061 (migration 0039, ADR-066) ;
 * - `HOLD_EXPIRED` (« reserva expirada », 17 §2.5 étape 3a), `QUOTE_UNAVAILABLE` (16 SRC, devis
 *   indisponible), `START_PASSED` (17 §2.5 2 bis (i)), `PAYMENT_METHOD_UNAVAILABLE` : PROPOSÉS par
 *   US-024 (migrations 0040, 0041, ADR-065) ; `PAYMENT_ATTEMPTS_EXCEEDED` : 16 fiche PAY-017
 *   (`payment_attempts_per_hold`) ;
 * - `DATES_NOTICE_TOO_SHORT` : 16 fiches CAL-003 et LST-006 (départ dans le préavis du lieu de
 *   remise ; migration 0071, US-119, ADR-101).
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
  'IDEMPOTENCY_CONFLICT',
  'LEG_SUM_MISMATCH',
  'FAKE_FORBIDDEN_IN_PRODUCTION',
  'PSP_ACCOUNT_INACTIVE',
  'PAYMENT_SUBJECT_MISMATCH',
  'FORBIDDEN',
  'INVALID_PERIOD',
  'PARAM_MISSING',
  'HOLD_LIMIT_REACHED',
  'HOLD_RATE_LIMITED',
  'HOST_NOT_ACTIVATED',
  'ACCOUNT_RESTRICTED',
  'SELF_BOOKING_FORBIDDEN',
  'BOOKING_UNDER_REVIEW',
  'HOST_PAYOUT_RAIL_UNAVAILABLE',
  'LEG_ALREADY_RELEASED',
  'HOLD_EXPIRED',
  'QUOTE_UNAVAILABLE',
  'START_PASSED',
  'PAYMENT_ATTEMPTS_EXCEEDED',
  'PAYMENT_METHOD_UNAVAILABLE',
  'DATES_NOTICE_TOO_SHORT',
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
  insufficientPrivilege: '42501',
  objectNotInPrerequisiteState: '55000',
} as const;

/**
 * Contraintes connues : `nom de contrainte → [SQLSTATE attendu, code métier]`. Les noms sont ceux
 * des migrations `packages/db/migrations/0004` à `0006`, `0016` à `0020`, `0027`, `0028`, `0032`,
 * `0037`, `0039`, `0040`, `0041` et `0054`.
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
  // gabarits juridiques et consentements (US-102, migration 0059)
  document_template_immutable: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  consent_append_only: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
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
  // 23000 : port PaymentProvider (0028, US-019)
  payment_operation_idempotency_conflict: [
    SQLSTATE.integrityConstraintViolation,
    'IDEMPOTENCY_CONFLICT',
  ],
  payment_operation_leg_sum: [SQLSTATE.integrityConstraintViolation, 'LEG_SUM_MISMATCH'],
  payment_operation_legs_complete: [SQLSTATE.integrityConstraintViolation, 'LEG_SUM_MISMATCH'],
  payment_operation_leg_negative: [SQLSTATE.integrityConstraintViolation, 'LEG_AMOUNT_NEGATIVE'],
  psp_account_fake_forbidden: [
    SQLSTATE.integrityConstraintViolation,
    'FAKE_FORBIDDEN_IN_PRODUCTION',
  ],
  psp_account_fake_sandbox_only: [SQLSTATE.checkViolation, 'FAKE_FORBIDDEN_IN_PRODUCTION'],
  payment_operation_account_active: [SQLSTATE.integrityConstraintViolation, 'PSP_ACCOUNT_INACTIVE'],
  payment_operation_subject_mismatch: [
    SQLSTATE.integrityConstraintViolation,
    'PAYMENT_SUBJECT_MISMATCH',
  ],
  // table d'occupation unique, blocages de l'hôte, tampons (0032, US-022)
  occupancy_host_forbidden: [SQLSTATE.insufficientPrivilege, 'FORBIDDEN'],
  occupancy_vehicle_single_org: [SQLSTATE.exclusionViolation, 'FORBIDDEN'],
  occupancy_period_invalid: [SQLSTATE.checkViolation, 'INVALID_PERIOD'],
  period_valid: [SQLSTATE.checkViolation, 'INVALID_PERIOD'],
  occupancy_buffer_trip_state: [SQLSTATE.objectNotInPrerequisiteState, 'INVALID_TRANSITION'],
  occupancy_buffer_param_missing: [SQLSTATE.objectNotInPrerequisiteState, 'PARAM_MISSING'],
  // holds de checkout et commandes de réservation (0037, US-023)
  hold_forbidden: [SQLSTATE.insufficientPrivilege, 'FORBIDDEN'],
  hold_vehicle_unknown: [SQLSTATE.objectNotInPrerequisiteState, 'VEHICLE_UNAVAILABLE'],
  hold_host_not_active: [SQLSTATE.objectNotInPrerequisiteState, 'HOST_NOT_ACTIVATED'],
  hold_self_booking: [SQLSTATE.objectNotInPrerequisiteState, 'SELF_BOOKING_FORBIDDEN'],
  // restriction de compte active du voyageur (0064, US-109 ; 16 ADM-005, BKG-012)
  hold_account_restricted: [SQLSTATE.objectNotInPrerequisiteState, 'ACCOUNT_RESTRICTED'],
  hold_param_missing: [SQLSTATE.objectNotInPrerequisiteState, 'PARAM_MISSING'],
  hold_guest_limit: [SQLSTATE.objectNotInPrerequisiteState, 'HOLD_LIMIT_REACHED'],
  hold_guest_overlap: [SQLSTATE.objectNotInPrerequisiteState, 'GUEST_OVERLAP'],
  hold_rate_limited: [SQLSTATE.objectNotInPrerequisiteState, 'HOLD_RATE_LIMITED'],
  // préavis minimum du lieu de remise (0071, US-119 ; 16 CAL-003)
  hold_notice_too_short: [SQLSTATE.objectNotInPrerequisiteState, 'DATES_NOTICE_TOO_SHORT'],
  hold_release_terminal: [SQLSTATE.objectNotInPrerequisiteState, 'INVALID_TRANSITION'],
  hold_guarded_columns: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  booking_record_no_delete: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  hold_review_before_payment: [SQLSTATE.checkViolation, 'BOOKING_UNDER_REVIEW'],
  // port de place de marché : sous-marchands, soldes par jambe (0039, US-061)
  host_payout_rail_unavailable: [
    SQLSTATE.objectNotInPrerequisiteState,
    'HOST_PAYOUT_RAIL_UNAVAILABLE',
  ],
  psp_submerchant_org_mismatch: [SQLSTATE.integrityConstraintViolation, 'PAYMENT_SUBJECT_MISMATCH'],
  psp_submerchant_country_unconfigured: [SQLSTATE.objectNotInPrerequisiteState, 'PARAM_MISSING'],
  psp_submerchant_org_inactive: [SQLSTATE.objectNotInPrerequisiteState, 'INVALID_TRANSITION'],
  psp_submerchant_attempt_invalid: [SQLSTATE.objectNotInPrerequisiteState, 'INVALID_TRANSITION'],
  psp_submerchant_one_live: [SQLSTATE.uniqueViolation, 'INVALID_TRANSITION'],
  psp_submerchant_transition: [SQLSTATE.integrityConstraintViolation, 'INVALID_TRANSITION'],
  psp_submerchant_immutable: [SQLSTATE.integrityConstraintViolation, 'IMMUTABLE_RECORD'],
  leg_already_released: [SQLSTATE.objectNotInPrerequisiteState, 'LEG_ALREADY_RELEASED'],
  leg_frozen: [SQLSTATE.objectNotInPrerequisiteState, 'LEG_ALREADY_RELEASED'],
  leg_movement_exceeds_balance: [SQLSTATE.objectNotInPrerequisiteState, 'LEG_AMOUNT_NEGATIVE'],
  leg_movement_not_succeeded: [SQLSTATE.objectNotInPrerequisiteState, 'INVALID_TRANSITION'],
  leg_movement_unsupported: [SQLSTATE.objectNotInPrerequisiteState, 'INVARIANT_VIOLATION'],
  // correctifs de la red team argent (0054, US-049, ADR-088) : rejeu des entrées d'un règlement,
  // remboursement borné par le règlement, versement gardé (trip terminé, interrupteurs)
  settlement_replay_mismatch: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_replay_unsupported: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_replay_input_invalid: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  settlement_trip_inputs_changed: [SQLSTATE.integrityConstraintViolation, 'INVARIANT_VIOLATION'],
  leg_refund_without_settlement: [SQLSTATE.objectNotInPrerequisiteState, 'INVARIANT_VIOLATION'],
  leg_refund_exceeds_settlement: [SQLSTATE.objectNotInPrerequisiteState, 'INVARIANT_VIOLATION'],
  leg_release_trip_not_completed: [SQLSTATE.objectNotInPrerequisiteState, 'INVALID_TRANSITION'],
  leg_release_not_due: [SQLSTATE.objectNotInPrerequisiteState, 'INVALID_TRANSITION'],
  leg_release_submerchant_inactive: [
    SQLSTATE.objectNotInPrerequisiteState,
    'HOST_PAYOUT_RAIL_UNAVAILABLE',
  ],
  leg_release_insurer_inactive: [SQLSTATE.objectNotInPrerequisiteState, 'FORBIDDEN'],
  leg_release_payouts_disabled: [SQLSTATE.objectNotInPrerequisiteState, 'FORBIDDEN'],
  leg_funds_holding_disabled: [SQLSTATE.objectNotInPrerequisiteState, 'FORBIDDEN'],
  // intention de paiement, conversion gardée et compensation (0040, 0041, US-024)
  hold_not_payable: [SQLSTATE.objectNotInPrerequisiteState, 'HOLD_EXPIRED'],
  hold_payment_terminal: [SQLSTATE.objectNotInPrerequisiteState, 'INVALID_TRANSITION'],
  payment_quote_unavailable: [SQLSTATE.objectNotInPrerequisiteState, 'QUOTE_UNAVAILABLE'],
  payment_start_passed: [SQLSTATE.objectNotInPrerequisiteState, 'START_PASSED'],
  payment_attempts_exceeded: [SQLSTATE.objectNotInPrerequisiteState, 'PAYMENT_ATTEMPTS_EXCEEDED'],
  payment_method_unavailable: [SQLSTATE.objectNotInPrerequisiteState, 'PAYMENT_METHOD_UNAVAILABLE'],
  conversion_forbidden: [SQLSTATE.insufficientPrivilege, 'FORBIDDEN'],
  conversion_review_pending: [SQLSTATE.objectNotInPrerequisiteState, 'BOOKING_UNDER_REVIEW'],
  // oracle C12 (US-025, 0045) : contexte autre que le travailleur booking_oracle
  oracle_forbidden: [SQLSTATE.insufficientPrivilege, 'FORBIDDEN'],
  // supervision (US-004, 0051) : contexte autre que le travailleur ops_monitor
  ops_monitor_forbidden: [SQLSTATE.insufficientPrivilege, 'FORBIDDEN'],
  payment_command_idem_unique: [SQLSTATE.uniqueViolation, 'DISPOSITION_EXISTS'],
  payment_operation_provider_reference_unique: [
    SQLSTATE.uniqueViolation,
    'PAYMENT_SUBJECT_MISMATCH',
  ],
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
