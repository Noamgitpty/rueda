/**
 * Codes d'erreur du moteur de règlement (US-017). Stables, SCREAMING_SNAKE_CASE, sans préfixe.
 * `REJECTED_TOO_EARLY` vient de 08 (`qualify`, règle 3) ; les autres sont PROPOSÉS (à reporter
 * au catalogue de 16 A.8 par une demande de fusion sur `docs/specs/`).
 */
export const SETTLEMENT_ERROR_CODES = [
  /** PROPOSÉ : motif hors du sous-ensemble bêta (moteur complet : US-518). */
  'SETTLEMENT_REASON_NOT_SUPPORTED',
  /** PROPOSÉ : entrée incomplète ou incohérente (drapeau requis absent, horodatage, total payé). */
  'SETTLEMENT_INPUT_INVALID',
  /** PROPOSÉ : paramètre requis absent ou invalide (barème de pénalité, part assureur). */
  'SETTLEMENT_CONFIG_INVALID',
  /** 08 `qualify` règle 3 : no-show déclaré avant `noShowAt` hors sous-motif de retrait. */
  'REJECTED_TOO_EARLY',
  /** PROPOSÉ : invariant d'équilibre violé (`remboursement + retenu + taxe retenue ≠ total`). */
  'SETTLEMENT_UNBALANCED',
  /**
   * 08 E7 règle 5 (nom PROPOSÉ par 08) : jambe capturée négative, ou jambe retenue négative hors
   * `PLATFORM` (US-018). Une `PLATFORM` retenue négative n'est pas une erreur : avance de Kmino et
   * revue FIN (`negativeLeg`).
   */
  'LEG_AMOUNT_NEGATIVE',
  /** PROPOSÉ (ADR-090) : promo > 0 ou prix < 0 (08 pseudo-code `LINES` : promos ≤ 0). */
  'LINE_SIGN_INVALID',
  /** PROPOSÉ (ADR-090) : Σ promos au-delà du prix du véhicule (08 BR-PAY-07, E7 règle 5). */
  'PROMO_EXCEEDS_TRIP_PRICE',
  /** PROPOSÉ (ADR-090) : total payé ≤ 0 (négatif : 08 E1 ; nul : défaut fail-closed, Q-013). */
  'TOTAL_PAID_NOT_POSITIVE',
  /**
   * PROPOSÉ (ADR-090) : remboursement hors de [0 ; total payé], ou taxe remboursée d'un groupe hors
   * de [0 ; taxe payée] (08 E1 ; Q-014).
   */
  'REFUND_OUT_OF_RANGE',
  /** PROPOSÉ (ADR-090) : taxe payée d'un groupe < 0 (groupe de promos seules ; Q-014). */
  'TAX_PAID_NEGATIVE',
] as const;

export type SettlementErrorCode = (typeof SETTLEMENT_ERROR_CODES)[number];

/**
 * Contexte d'un refus, lisible par le service appelant pour l'alerte FIN (ADR-090) : montants en
 * chaînes d'unités mineures, devise, motif, identifiant de groupe fiscal. Jamais de donnée
 * personnelle : le moteur n'en reçoit pas.
 */
export type SettlementErrorDetails = Readonly<Record<string, string>>;

export class SettlementError extends Error {
  readonly code: SettlementErrorCode;
  readonly details: SettlementErrorDetails | undefined;

  constructor(code: SettlementErrorCode, message: string, details?: SettlementErrorDetails) {
    super(`${code}: ${message}`);
    this.name = 'SettlementError';
    this.code = code;
    this.details = details === undefined ? undefined : Object.freeze({ ...details });
  }
}

export function isSettlementError(
  error: unknown,
  code?: SettlementErrorCode,
): error is SettlementError {
  return error instanceof SettlementError && (code === undefined || error.code === code);
}
